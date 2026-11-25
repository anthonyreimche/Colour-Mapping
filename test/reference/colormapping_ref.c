/*
    darktable's colour mapping module (src/iop/colormapping.c, release-5.6.1)
    and the bilateral grid it smooths with (src/common/bilateral.c and
    bilateral.h), run over fixed images and printed as JSON for the
    extension's tests (`npm run reference` writes vectors.json).

    colormapping.c: Copyright (C) 2013-2026 darktable developers.
    bilateral.c: Copyright (C) 2016-2026 darktable developers.
    bilateral.h: Copyright (C) 2012-2023 darktable developers.
    All GPL-3.0-or-later.

    The functions are copied as upstream has them, with the OpenMP plumbing
    taken out: one thread, so every sum runs in pixel order. Two places differ,
    each the extension's documented deviation (docs/SPEC.md):
      - kmeans() starts from a seeded generator (seeded_points_get) instead of
        dt_points_get(), so the same frame always gives the same clusters;
      - a variance that comes out below zero is taken as zero before its square
        root, where upstream's sqrtf gives NaN.
    Built with -ffp-contract=off and without bilateral.c's fast-math pragma, so
    each float operation rounds as written.
*/
#include <float.h>
#include <math.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define HISTN (1 << 11)
#define MAXN 5

/* glib */
#define CLAMP(x, low, high) (((x) > (high)) ? (high) : (((x) < (low)) ? (low) : (x)))
#define MIN(a, b) (((a) < (b)) ? (a) : (b))
#define MAX(a, b) (((a) > (b)) ? (a) : (b))
/* darktable's common/darktable.h */
#define CLAMPS(A, L, H) ((A) > (L) ? ((A) < (H) ? (A) : (H)) : (L))

typedef float float2[2];
typedef float dt_aligned_pixel_t[4];

static inline void copy_pixel(float *const out, const float *const in)
{
  for(int c = 0; c < 4; c++) out[c] = in[c];
}

/* ── the seeded generator (mulberry32), in place of dt_points_get() ──────── */

#define KMEANS_SEED 0x2545F491u
static uint32_t rng_state;

static void seed_points(void) { rng_state = KMEANS_SEED; }

static float seeded_points_get(void)
{
  rng_state += 0x6D2B79F5u;
  uint32_t t = rng_state;
  t = (t ^ (t >> 15)) * (t | 1u);
  t ^= t + (t ^ (t >> 7)) * (t | 61u);
  t ^= t >> 14;
  return (float)(t >> 8) * (1.0f / 16777216.0f);
}

/* ── src/common/bilateral.h ─────────────────────────────────────────────── */

typedef struct dt_bilateral_t
{
  size_t size_x, size_y, size_z;
  int width, height;
  int numslices, sliceheight, slicerows;
  float sigma_s, sigma_r;
  float sigma_s_inv, sigma_r_inv;
  float *buf;
} dt_bilateral_t;

/* ── src/common/bilateral.c ─────────────────────────────────────────────── */

#define DT_COMMON_BILATERAL_MAX_RES_S 3000
#define DT_COMMON_BILATERAL_MAX_RES_R 50

static void dt_bilateral_grid_size(dt_bilateral_t *b, const int width, const int height, const float L_range,
                                   float sigma_s, const float sigma_r)
{
  if(sigma_s < 0.5) sigma_s = 0.5;
  float _x = CLAMPS((int)roundf(width / sigma_s), 4, DT_COMMON_BILATERAL_MAX_RES_S);
  float _y = CLAMPS((int)roundf(height / sigma_s), 4, DT_COMMON_BILATERAL_MAX_RES_S);
  float _z = CLAMPS((int)roundf(L_range / sigma_r), 4, DT_COMMON_BILATERAL_MAX_RES_R);
  b->sigma_s = MAX(height / _y, width / _x);
  b->sigma_r = L_range / _z;
  b->sigma_s_inv = 1.0f / b->sigma_s;
  b->sigma_r_inv = 1.0f / b->sigma_r;
  b->size_x = (int)ceilf(width * b->sigma_s_inv) + 1;
  b->size_y = (int)ceilf(height * b->sigma_s_inv) + 1;
  b->size_z = (int)ceilf(L_range * b->sigma_r_inv) + 1;
}

static size_t image_to_grid(const dt_bilateral_t *const b, const int i, const int j, const float L, float *xf,
                            float *yf, float *zf)
{
  float x = CLAMPS(i * b->sigma_s_inv, 0, b->size_x - 1);
  float y = CLAMPS(j * b->sigma_s_inv, 0, b->size_y - 1);
  float z = CLAMPS(L * b->sigma_r_inv, 0, b->size_z - 1);
  const int xi = MIN((int)x, b->size_x - 2);
  const int yi = MIN((int)y, b->size_y - 2);
  const int zi = MIN((int)z, b->size_z - 2);
  *xf = x - xi;
  *yf = y - yi;
  *zf = z - zi;
  return ((xi + yi * b->size_x) * b->size_z) + zi;
}

static size_t image_to_relgrid(const dt_bilateral_t *const b, const int i, const float L, float *xf, float *zf)
{
  float x = CLAMPS(i * b->sigma_s_inv, 0, b->size_x - 1);
  float z = CLAMPS(L * b->sigma_r_inv, 0, b->size_z - 1);
  const int xi = MIN((int)x, b->size_x - 2);
  const int zi = MIN((int)z, b->size_z - 2);
  *xf = x - xi;
  *zf = z - zi;
  return (xi * b->size_z) + zi;
}

static dt_bilateral_t *dt_bilateral_init(const int width, const int height, const float sigma_s, const float sigma_r)
{
  dt_bilateral_t *b = malloc(sizeof(dt_bilateral_t));
  if(!b) return NULL;
  dt_bilateral_grid_size(b, width, height, 100.0f, sigma_s, sigma_r);
  b->width = width;
  b->height = height;
  b->numslices = 1;
  b->sliceheight = (height + b->numslices - 1) / b->numslices;
  b->slicerows = (b->size_y + b->numslices - 1) / b->numslices + 2;
  b->buf = calloc(b->size_x * b->size_z * b->numslices * b->slicerows, sizeof(float));
  if(!b->buf)
  {
    free(b);
    return NULL;
  }
  return b;
}

static void dt_bilateral_splat(const dt_bilateral_t *b, const float *const in)
{
  if(!b || !b->buf) return;

  const int ox = b->size_z;
  const int oy = b->size_x * b->size_z;
  const int oz = 1;
  const float sigma_s = b->sigma_s * b->sigma_s;
  float *const buf = b->buf;

  const size_t offsets[8] = { 0, ox, oy, ox + oy, oz, oz + ox, oz + oy, oz + oy + ox };

  for(int slice = 0; slice < b->numslices; slice++)
  {
    const int firstrow = slice * b->sliceheight;
    const int lastrow = MIN((slice + 1) * b->sliceheight, b->height);
    const int slice_offset = slice * b->slicerows - (int)(firstrow * b->sigma_s_inv);
    for(int j = firstrow; j < lastrow; j++)
    {
      float y = CLAMPS(j * b->sigma_s_inv, 0, b->size_y - 1);
      const int yi = MIN((int)y, b->size_y - 2);
      const float yf = y - yi;
      const size_t base = (size_t)(yi + slice_offset) * oy;
      for(int i = 0; i < b->width; i++)
      {
        size_t index = 4 * (j * b->width + i);
        float xf, zf;
        const float L = in[index];
        const size_t grid_index = base + image_to_relgrid(b, i, L, &xf, &zf);
        const dt_aligned_pixel_t contrib = {
          (1.0f - xf) * (1.0f - yf) * 100.0f / sigma_s,
          xf * (1.0f - yf) * 100.0f / sigma_s,
          (1.0f - xf) * yf * 100.0f / sigma_s,
          xf * yf * 100.0f / sigma_s,
        };
        for(int k = 0; k < 4; k++)
        {
          buf[grid_index + offsets[k]] += (contrib[k] * (1.0f - zf));
          buf[grid_index + offsets[k + 4]] += (contrib[k] * zf);
        }
      }
    }
  }
}

static void blur_line_z(float *buf, const int offset1, const int offset2, const int offset3, const int size1,
                        const int size2, const int size3)
{
  const float w1 = 4.f / 16.f;
  const float w2 = 2.f / 16.f;
  for(int k = 0; k < size1; k++)
  {
    size_t index = (size_t)k * offset1;
    for(int j = 0; j < size2; j++)
    {
      float tmp1 = buf[index];
      buf[index] = w1 * buf[index + offset3] + w2 * buf[index + 2 * offset3];
      index += offset3;
      float tmp2 = buf[index];
      buf[index] = w1 * (buf[index + offset3] - tmp1) + w2 * buf[index + 2 * offset3];
      index += offset3;
      for(int i = 2; i < size3 - 2; i++)
      {
        const float tmp3 = buf[index];
        buf[index] = +w1 * (buf[index + offset3] - tmp2) + w2 * (buf[index + 2 * offset3] - tmp1);
        index += offset3;
        tmp1 = tmp2;
        tmp2 = tmp3;
      }
      const float tmp3 = buf[index];
      buf[index] = w1 * (buf[index + offset3] - tmp2) - w2 * tmp1;
      index += offset3;
      buf[index] = -w1 * tmp3 - w2 * tmp2;
      index += offset3;
      index += offset2 - offset3 * size3;
    }
  }
}

static void blur_line(float *buf, const int offset1, const int offset2, const int offset3, const int size1,
                      const int size2, const int size3)
{
  const float w0 = 6.f / 16.f;
  const float w1 = 4.f / 16.f;
  const float w2 = 1.f / 16.f;
  for(int k = 0; k < size1; k++)
  {
    size_t index = (size_t)k * offset1;
    for(int j = 0; j < size2; j++)
    {
      float tmp1 = buf[index];
      buf[index] = buf[index] * w0 + w1 * buf[index + offset3] + w2 * buf[index + 2 * offset3];
      index += offset3;
      float tmp2 = buf[index];
      buf[index] = buf[index] * w0 + w1 * (buf[index + offset3] + tmp1) + w2 * buf[index + 2 * offset3];
      index += offset3;
      for(int i = 2; i < size3 - 2; i++)
      {
        const float tmp3 = buf[index];
        buf[index] = buf[index] * w0 + w1 * (buf[index + offset3] + tmp2) + w2 * (buf[index + 2 * offset3] + tmp1);
        index += offset3;
        tmp1 = tmp2;
        tmp2 = tmp3;
      }
      const float tmp3 = buf[index];
      buf[index] = buf[index] * w0 + w1 * (buf[index + offset3] + tmp2) + w2 * tmp1;
      index += offset3;
      buf[index] = buf[index] * w0 + w1 * tmp3 + w2 * tmp2;
      index += offset3;
      index += offset2 - offset3 * size3;
    }
  }
}

static void dt_bilateral_blur(const dt_bilateral_t *b)
{
  if(!b || !b->buf) return;
  const int ox = b->size_z;
  const int oy = b->size_x * b->size_z;
  const int oz = 1;
  blur_line(b->buf, oz, oy, ox, b->size_z, b->size_y, b->size_x);
  blur_line(b->buf, oz, ox, oy, b->size_z, b->size_x, b->size_y);
  blur_line_z(b->buf, ox, oy, oz, b->size_x, b->size_y, b->size_z);
}

static void dt_bilateral_slice(const dt_bilateral_t *const b, const float *const in, float *out, const float detail)
{
  if(!b || !b->buf) return;
  const float norm = -detail * b->sigma_r * 0.04f;
  const int ox = b->size_z;
  const int oy = b->size_x * b->size_z;
  const int oz = 1;
  float *const buf = b->buf;
  const int width = b->width;
  const int height = b->height;

  for(int j = 0; j < height; j++)
  {
    for(int i = 0; i < width; i++)
    {
      size_t index = 4 * (j * width + i);
      float xf, yf, zf;
      const float L = in[index];
      const size_t gi = image_to_grid(b, i, j, L, &xf, &yf, &zf);
      const float Lout = fmaxf(0.0f, L
                                        + norm * (buf[gi] * (1.0f - xf) * (1.0f - yf) * (1.0f - zf)
                                                  + buf[gi + ox] * (xf) * (1.0f - yf) * (1.0f - zf)
                                                  + buf[gi + oy] * (1.0f - xf) * (yf) * (1.0f - zf)
                                                  + buf[gi + ox + oy] * (xf) * (yf) * (1.0f - zf)
                                                  + buf[gi + oz] * (1.0f - xf) * (1.0f - yf) * (zf)
                                                  + buf[gi + ox + oz] * (xf) * (1.0f - yf) * (zf)
                                                  + buf[gi + oy + oz] * (1.0f - xf) * (yf) * (zf)
                                                  + buf[gi + ox + oy + oz] * (xf) * (yf) * (zf)));
      copy_pixel(out + index, in + index);
      out[index] = Lout;
    }
  }
}

static void dt_bilateral_free(dt_bilateral_t *b)
{
  if(!b) return;
  free(b->buf);
  free(b);
}

/* ── src/iop/colormapping.c ─────────────────────────────────────────────── */

static void capture_histogram(const float *col, const int width, const int height, int *hist)
{
  memset(hist, 0, sizeof(int) * HISTN);
  for(int k = 0; k < height; k++)
    for(int i = 0; i < width; i++)
    {
      const int bin = CLAMP(HISTN * col[4 * (k * width + i) + 0] / 100.0, 0, HISTN - 1);
      hist[bin]++;
    }

  for(int k = 1; k < HISTN; k++) hist[k] += hist[k - 1];
  for(int k = 0; k < HISTN; k++)
    hist[k] = (int)CLAMP(hist[k] * (HISTN / (float)hist[HISTN - 1]), 0, HISTN - 1);
}

static void invert_histogram(const int *hist, float *inv_hist)
{
  int last = 31;
  for(int i = 0; i <= last; i++) inv_hist[i] = 100.0f * i / (float)HISTN;
  for(int i = last + 1; i < HISTN; i++)
    for(int k = last; k < HISTN; k++)
      if(hist[k] >= i)
      {
        last = k;
        inv_hist[i] = 100.0f * k / (float)HISTN;
        break;
      }
}

static void get_cluster_mapping(const int n, float2 *mi, const float *wi, float2 *mo, const float *wo,
                                const float dominance, int *mapio)
{
  const float weightscale = 10000.0f;

  for(int ki = 0; ki < n; ki++)
  {
    float mdist = FLT_MAX;
    for(int ko = 0; ko < n; ko++)
    {
      const float colordist = (mo[ko][0] - mi[ki][0]) * (mo[ko][0] - mi[ki][0])
                              + (mo[ko][1] - mi[ki][1]) * (mo[ko][1] - mi[ki][1]);
      const float weightdist = weightscale * (wo[ko] - wi[ki]) * (wo[ko] - wi[ki]);
      const float dist = colordist * (1.0f - dominance) + weightdist * dominance;
      if(dist < mdist)
      {
        mdist = dist;
        mapio[ki] = ko;
      }
    }
  }
}

static void get_clusters(const float *col, const int n, float2 *mean, float *weight)
{
  float mdist = FLT_MAX;
  for(int k = 0; k < n; k++)
  {
    const float dist2 = (col[1] - mean[k][0]) * (col[1] - mean[k][0]) + (col[2] - mean[k][1]) * (col[2] - mean[k][1]);
    weight[k] = dist2 > 1.0e-6f ? 1.0f / dist2 : -1.0f;
    if(dist2 < mdist) mdist = dist2;
  }
  if(mdist < 1.0e-6f)
    for(int k = 0; k < n; k++) weight[k] = weight[k] < 0.0f ? 1.0f : 0.0f;
  float sum = 0.0f;
  for(int k = 0; k < n; k++) sum += weight[k];
  if(sum > 0.0f)
    for(int k = 0; k < n; k++) weight[k] /= sum;
}

static int get_cluster(const float *col, const int n, float2 *mean)
{
  float mdist = FLT_MAX;
  int cluster = 0;
  for(int k = 0; k < n; k++)
  {
    const float dist = (col[1] - mean[k][0]) * (col[1] - mean[k][0]) + (col[2] - mean[k][1]) * (col[2] - mean[k][1]);
    if(dist < mdist)
    {
      mdist = dist;
      cluster = k;
    }
  }
  return cluster;
}

/* The variances each run ends with before elimination and the square root,
   which the tests read to show the negative case occurs. */
static float2 raw_var[MAXN];

static void kmeans(const float *col, const int width, const int height, const int n, float2 *mean_out,
                   float2 *var_out, float *weight_out)
{
  const int nit = 40;

  float2 *const mean = malloc(sizeof(float2) * n);
  float2 *const var = malloc(sizeof(float2) * n);
  int *const cnt = malloc(sizeof(int) * n);
  int count;

  float a_min = FLT_MAX, b_min = FLT_MAX, a_max = -FLT_MAX, b_max = -FLT_MAX;

  const size_t npixels = (size_t)height * width;
  for(size_t k = 0; k < npixels; k++)
  {
    const float a = col[4 * k + 1];
    const float b = col[4 * k + 2];
    a_min = fminf(a, a_min);
    a_max = fmaxf(a, a_max);
    b_min = fminf(b, b_min);
    b_max = fmaxf(b, b_max);
  }

  seed_points();
  for(int k = 0; k < n; k++)
  {
    mean_out[k][0] = 0.9f * (a_min + (a_max - a_min) * seeded_points_get());
    mean_out[k][1] = 0.9f * (b_min + (b_max - b_min) * seeded_points_get());
    var_out[k][0] = var_out[k][1] = weight_out[k] = 0.0f;
    mean[k][0] = mean[k][1] = var[k][0] = var[k][1] = 0.0f;
  }
  for(int it = 0; it < nit; it++)
  {
    for(int clus = 0; clus < n; clus++)
    {
      cnt[clus] = 0;
      mean[clus][0] = mean[clus][1] = 0.0f;
      var[clus][0] = var[clus][1] = 0.0f;
    }
    for(size_t k = 0; k < npixels; k++)
    {
      dt_aligned_pixel_t Lab;
      copy_pixel(Lab, col + 4 * k);
      const int c = get_cluster(Lab, n, mean_out);
      cnt[c]++;
      var[c][0] += Lab[1] * Lab[1];
      var[c][1] += Lab[2] * Lab[2];
      mean[c][0] += Lab[1];
      mean[c][1] += Lab[2];
    }
    for(int k = 0; k < n; k++)
    {
      if(cnt[k] == 0) continue;
      mean_out[k][0] = mean[k][0] / cnt[k];
      mean_out[k][1] = mean[k][1] / cnt[k];
      var_out[k][0] = var[k][0] / cnt[k] - mean_out[k][0] * mean_out[k][0];
      var_out[k][1] = var[k][1] / cnt[k] - mean_out[k][1] * mean_out[k][1];
      mean[k][0] = mean[k][1] = var[k][0] = var[k][1] = 0.0f;
    }

    count = 0;
    for(int k = 0; k < n; k++) count += cnt[k];
    for(int k = 0; k < n; k++) weight_out[k] = (count > 0) ? (float)cnt[k] / count : 0.0f;
  }

  free(cnt);
  free(var);
  free(mean);

  for(int k = 0; k < n; k++)
  {
    raw_var[k][0] = var_out[k][0];
    raw_var[k][1] = var_out[k][1];

    if(var_out[k][0] == 0.0f || var_out[k][1] == 0.0f)
      mean_out[k][0] = mean_out[k][1] = var_out[k][0] = var_out[k][1] = weight_out[k] = 0;

    /* deviation: a variance below zero is taken as zero */
    var_out[k][0] = sqrtf(var_out[k][0] > 0.0f ? var_out[k][0] : 0.0f);
    var_out[k][1] = sqrtf(var_out[k][1] > 0.0f ? var_out[k][1] : 0.0f);
  }

  for(int i = 0; i < n - 1; i++)
  {
    for(int j = 0; j < n - 1 - i; j++)
    {
      if(weight_out[j] > weight_out[j + 1])
      {
        float2 temp_mean = { mean_out[j + 1][0], mean_out[j + 1][1] };
        float2 temp_var = { var_out[j + 1][0], var_out[j + 1][1] };
        float temp_weight = weight_out[j + 1];

        mean_out[j + 1][0] = mean_out[j][0];
        mean_out[j + 1][1] = mean_out[j][1];
        var_out[j + 1][0] = var_out[j][0];
        var_out[j + 1][1] = var_out[j][1];
        weight_out[j + 1] = weight_out[j];

        mean_out[j][0] = temp_mean[0];
        mean_out[j][1] = temp_mean[1];
        var_out[j][0] = temp_var[0];
        var_out[j][1] = temp_var[1];
        weight_out[j] = temp_weight;
      }
    }
  }
}

typedef struct params_t
{
  int n;
  float dominance;
  float equalization;
  float source_ihist[HISTN];
  float2 source_mean[MAXN];
  float2 source_var[MAXN];
  float source_weight[MAXN];
  int target_hist[HISTN];
  float2 target_mean[MAXN];
  float2 target_var[MAXN];
  float target_weight[MAXN];
} params_t;

/* process() at scale 1 (sigma_s given), both flags set. */
static void process(const params_t *data, const float *in, float *out, const int width, const int height,
                    const float sigma_s)
{
  const float sigma_r = 8.0f;
  const float dominance = data->dominance / 100.0f;
  const float equalization = data->equalization / 100.0f;

  int mapio[MAXN];
  get_cluster_mapping(data->n, (float2 *)data->target_mean, data->target_weight, (float2 *)data->source_mean,
                      data->source_weight, dominance, mapio);

  float2 var_ratio[MAXN];
  for(int i = 0; i < data->n; i++)
  {
    var_ratio[i][0] = (data->target_var[i][0] > 0.0f) ? data->source_var[mapio[i]][0] / data->target_var[i][0] : 0.0f;
    var_ratio[i][1] = (data->target_var[i][1] > 0.0f) ? data->source_var[mapio[i]][1] / data->target_var[i][1] : 0.0f;
  }

  const size_t npixels = (size_t)height * width;
  for(size_t k = 0; k < npixels * 4; k += 4)
  {
    const float L = in[k];
    out[k] = 0.5f * ((L * (1.0f - equalization)
                      + data->source_ihist[data->target_hist[(int)CLAMP(HISTN * L / 100.0f, 0.0f, (float)HISTN - 1.0f)]]
                            * equalization)
                     - L)
             + 50.0f;
    out[k] = CLAMP(out[k], 0.0f, 100.0f);
  }

  if(equalization > 0.001f)
  {
    dt_bilateral_t *b = dt_bilateral_init(width, height, sigma_s, sigma_r);
    dt_bilateral_splat(b, out);
    dt_bilateral_blur(b);
    dt_bilateral_slice(b, out, out, -1.0f);
    dt_bilateral_free(b);
  }

  float weight[MAXN];
  for(size_t j = 0; j < 4 * npixels; j += 4)
  {
    const float L = in[j];
    const dt_aligned_pixel_t Lab = { L, in[j + 1], in[j + 2] };

    out[j] = 2.0f * (out[j] - 50.0f) + L;
    out[j] = CLAMP(out[j], 0.0f, 100.0f);

    get_clusters(in + j, data->n, (float2 *)data->target_mean, weight);
    out[j + 1] = out[j + 2] = 0.0f;
    for(int c = 0; c < data->n; c++)
    {
      out[j + 1] += weight[c] * ((Lab[1] - data->target_mean[c][0]) * var_ratio[c][0] + data->source_mean[mapio[c]][0]);
      out[j + 2] += weight[c] * ((Lab[2] - data->target_mean[c][1]) * var_ratio[c][1] + data->source_mean[mapio[c]][1]);
    }
    out[j + 3] = in[j + 3];
  }
}

/* ── test images ────────────────────────────────────────────────────────── */

static uint32_t image_state;
static float image_rand(void)
{
  image_state = image_state * 1664525u + 1013904223u;
  return (float)(image_state >> 8) * (1.0f / 16777216.0f);
}

/* Lab pixels: kind 0 three soft colour blobs over a lightness ramp; 1 the
   same with two flat patches of whole-number a, b; 2 a flat patch of
   fractional a, b; 3 two colours only; 4 a darker, bluer scene. */
static float *make_image(const int kind, const int w, const int h, const uint32_t seed)
{
  float *px = malloc(sizeof(float) * 4 * w * h);
  image_state = seed;
  for(int y = 0; y < h; y++)
    for(int x = 0; x < w; x++)
    {
      float *p = px + 4 * (y * w + x);
      const float u = (float)x / (w - 1), v = (float)y / (h - 1);
      float L = 8.0f + 84.0f * (0.6f * u + 0.4f * v) + 6.0f * (image_rand() - 0.5f);
      float a, b;
      const int blob = (x * 3) / w;
      if(blob == 0) { a = 28.0f; b = 12.0f; }
      else if(blob == 1) { a = -22.0f; b = 30.0f; }
      else { a = 6.0f; b = -34.0f; }
      a += 14.0f * (image_rand() - 0.5f) + 8.0f * v;
      b += 14.0f * (image_rand() - 0.5f) - 6.0f * u;
      if(kind == 1)
      {
        if(x < w / 4 && y < h / 3) { a = 10.0f; b = -5.0f; }
        else if(x >= (3 * w) / 4 && y >= (2 * h) / 3) { a = -20.0f; b = 30.0f; }
      }
      else if(kind == 2)
      {
        if(y < h / 2 && x < w / 2) { a = 0.1f; b = -0.3f; }
      }
      else if(kind == 3)
      {
        a = blob == 0 ? 15.0f : -15.0f;
        b = blob == 0 ? 5.0f : 25.0f;
      }
      else if(kind == 4)
      {
        L = 4.0f + 50.0f * u * u + 30.0f * v + 4.0f * (image_rand() - 0.5f);
        a = a * 0.6f - 8.0f;
        b = b * 0.7f - 14.0f;
      }
      p[0] = L;
      p[1] = a;
      p[2] = b;
      p[3] = 1.0f;
    }
  return px;
}

/* ── output ─────────────────────────────────────────────────────────────── */

static int first;
static void sep(void)
{
  if(!first) putchar(',');
  first = 0;
}
static void fl(const float v) { printf("%.9g", (double)v); }
static void floats(const float *v, const int n)
{
  putchar('[');
  for(int i = 0; i < n; i++)
  {
    if(i) putchar(',');
    fl(v[i]);
  }
  putchar(']');
}
static void ints(const int *v, const int n)
{
  putchar('[');
  for(int i = 0; i < n; i++) printf(i ? ",%d" : "%d", v[i]);
  putchar(']');
}

static void print_image(const float *px, const int w, const int h) { floats(px, 4 * w * h); }

static void print_clusters(const int n, float2 *mean, float2 *var, float *weight)
{
  printf("\"mean\":");
  floats(&mean[0][0], 2 * n);
  printf(",\"sd\":");
  floats(&var[0][0], 2 * n);
  printf(",\"weight\":");
  floats(weight, n);
}

int main(void)
{
  printf("{\"seed\":%u,\"rng\":", KMEANS_SEED);
  {
    float r[16];
    seed_points();
    for(int i = 0; i < 16; i++) r[i] = seeded_points_get();
    floats(r, 16);
  }

  /* capture_histogram over lightness lists, then invert_histogram */
  printf(",\"histograms\":[");
  first = 1;
  {
    static const int counts[] = { 600, 1200, 64 };
    for(int c = 0; c < 4; c++)
    {
      const int n = c < 3 ? counts[c] : 2 * HISTN;
      float *px = malloc(sizeof(float) * 4 * n);
      image_state = 77u + c;
      for(int i = 0; i < n; i++)
      {
        float L;
        if(c == 0) L = 100.0f * image_rand();
        else if(c == 1) L = image_rand() < 0.5f ? 20.0f + 3.0f * image_rand() : 80.0f + 5.0f * image_rand();
        else if(c == 2) L = -10.0f + 120.0f * image_rand();
        else
        {
          /* each bin's edge, the float before it and the float after it */
          const float edge = 100.0f * (i / 2) / (float)HISTN;
          L = (i & 1) ? nextafterf(edge, -1.0f) : nextafterf(edge, 200.0f);
          if(i % 6 == 0) L = edge;
        }
        px[4 * i] = L;
        px[4 * i + 1] = px[4 * i + 2] = 0.0f;
        px[4 * i + 3] = 1.0f;
      }
      int hist[HISTN];
      float inv[HISTN];
      capture_histogram(px, n, 1, hist);
      invert_histogram(hist, inv);
      sep();
      printf("{\"L\":");
      float *L = malloc(sizeof(float) * n);
      for(int i = 0; i < n; i++) L[i] = px[4 * i];
      floats(L, n);
      printf(",\"hist\":");
      ints(hist, HISTN);
      printf(",\"inv\":");
      floats(inv, HISTN);
      printf("}");
      free(L);
      free(px);
    }
  }
  printf("]");

  /* kmeans */
  printf(",\"kmeans\":[");
  first = 1;
  {
    static const struct { const char *name; int kind, w, h, n; uint32_t seed; } cases[] = {
      { "three blobs, 3 clusters", 0, 40, 30, 3, 11u },
      { "three blobs, 1 cluster", 0, 40, 30, 1, 11u },
      { "three blobs, 5 clusters", 0, 40, 30, 5, 11u },
      { "two flat patches, 3 clusters", 1, 40, 30, 3, 12u },
      { "two flat patches, 5 clusters", 1, 40, 30, 5, 12u },
      { "a fractional flat patch, 4 clusters", 2, 40, 30, 4, 13u },
      { "two colours, 5 clusters", 3, 24, 16, 5, 14u },
      { "dark blue scene, 3 clusters", 4, 40, 30, 3, 15u },
    };
    for(size_t c = 0; c < sizeof(cases) / sizeof(cases[0]); c++)
    {
      float *px = make_image(cases[c].kind, cases[c].w, cases[c].h, cases[c].seed);
      float2 mean[MAXN], var[MAXN];
      float weight[MAXN];
      kmeans(px, cases[c].w, cases[c].h, cases[c].n, mean, var, weight);
      sep();
      printf("{\"name\":\"%s\",\"w\":%d,\"h\":%d,\"n\":%d,\"lab\":", cases[c].name, cases[c].w, cases[c].h, cases[c].n);
      print_image(px, cases[c].w, cases[c].h);
      printf(",\"rawVar\":");
      floats(&raw_var[0][0], 2 * cases[c].n);
      putchar(',');
      print_clusters(cases[c].n, mean, var, weight);
      printf("}");
      free(px);
    }
  }
  printf("]");

  /* get_cluster_mapping */
  printf(",\"mapping\":[");
  first = 1;
  {
    float2 mi[MAXN] = { { 10, 5 }, { -20, 30 }, { 0, 0 }, { 0, 0 }, { 40, -10 } };
    float wi[MAXN] = { 0.1f, 0.25f, 0.0f, 0.0f, 0.65f };
    float2 mo[MAXN] = { { 12, 3 }, { 0, 0 }, { -25, 28 }, { 35, -12 }, { 0, 0 } };
    float wo[MAXN] = { 0.3f, 0.0f, 0.2f, 0.5f, 0.0f };
    static const float doms[] = { 0.0f, 0.3f, 0.5f, 1.0f };
    for(int n = 1; n <= MAXN; n++)
      for(int d = 0; d < 4; d++)
      {
        int mapio[MAXN] = { 0 };
        get_cluster_mapping(n, mi, wi, mo, wo, doms[d], mapio);
        sep();
        printf("{\"n\":%d,\"dominance\":", n);
        fl(doms[d]);
        printf(",\"mi\":");
        floats(&mi[0][0], 2 * n);
        printf(",\"wi\":");
        floats(wi, n);
        printf(",\"mo\":");
        floats(&mo[0][0], 2 * n);
        printf(",\"wo\":");
        floats(wo, n);
        printf(",\"mapio\":");
        ints(mapio, n);
        printf("}");
      }
    /* ties: every source cluster the same distance away */
    float2 tie[MAXN] = { { 3, 4 }, { 3, 4 }, { -3, -4 }, { 0, 0 }, { 0, 0 } };
    float tw[MAXN] = { 0.2f, 0.2f, 0.2f, 0.2f, 0.2f };
    for(int d = 0; d < 4; d++)
    {
      int mapio[MAXN] = { 0 };
      get_cluster_mapping(MAXN, tie, tw, tie, tw, doms[d], mapio);
      sep();
      printf("{\"n\":%d,\"dominance\":", MAXN);
      fl(doms[d]);
      printf(",\"mi\":");
      floats(&tie[0][0], 2 * MAXN);
      printf(",\"wi\":");
      floats(tw, MAXN);
      printf(",\"mo\":");
      floats(&tie[0][0], 2 * MAXN);
      printf(",\"wo\":");
      floats(tw, MAXN);
      printf(",\"mapio\":");
      ints(mapio, MAXN);
      printf("}");
    }
  }
  printf("]");

  /* get_clusters: Shepard weights, with two clusters eliminated to (0, 0) */
  printf(",\"weights\":[");
  first = 1;
  {
    float2 mean[MAXN] = { { 0, 0 }, { 0, 0 }, { 12, -7 }, { -30, 22 }, { 5, 5 } };
    static const float cols[][2] = { { 0, 0 }, { 0.0005f, 0.0f }, { 0.001f, 0.0f }, { 12, -7 }, { 5, 5 },
                                     { 1, 1 }, { -10, 4 }, { 40, 40 }, { 12.0001f, -7.0f } };
    for(int n = 1; n <= MAXN; n++)
      for(size_t c = 0; c < sizeof(cols) / sizeof(cols[0]); c++)
      {
        const float col[4] = { 50.0f, cols[c][0], cols[c][1], 1.0f };
        float w[MAXN];
        get_clusters(col, n, mean, w);
        sep();
        printf("{\"n\":%d,\"mean\":", n);
        floats(&mean[0][0], 2 * n);
        printf(",\"ab\":");
        floats(col + 1, 2);
        printf(",\"weight\":");
        floats(w, n);
        printf("}");
      }
  }
  printf("]");

  /* the whole module: analyse a source and a target, then process the target */
  printf(",\"process\":[");
  first = 1;
  {
    static const struct {
      const char *name;
      int source_kind, target_kind, w, h, n;
      float dominance, equalization, sigma_s;
    } cases[] = {
      { "no equalisation", 4, 0, 48, 32, 3, 100.0f, 0.0f, 50.0f },
      { "equalisation 0.05 %, below the bilateral's threshold", 4, 0, 48, 32, 3, 100.0f, 0.05f, 50.0f },
      { "defaults: dominance 100 %, equalisation 50 %", 4, 0, 48, 32, 3, 100.0f, 50.0f, 50.0f },
      { "dominance 30 %, equalisation 50 %, a finer grid", 0, 4, 48, 32, 3, 30.0f, 50.0f, 6.0f },
      { "dominance 0, equalisation 100 %, 5 clusters", 4, 0, 48, 32, 5, 0.0f, 100.0f, 3.0f },
      { "a target with eliminated clusters", 0, 1, 48, 32, 3, 100.0f, 70.0f, 8.0f },
      { "1 cluster, equalisation 20 %", 0, 4, 48, 32, 1, 50.0f, 20.0f, 12.0f },
    };
    for(size_t c = 0; c < sizeof(cases) / sizeof(cases[0]); c++)
    {
      const int w = cases[c].w, h = cases[c].h, n = cases[c].n;
      float *src = make_image(cases[c].source_kind, w, h, 101u + c);
      float *tgt = make_image(cases[c].target_kind, w, h, 201u + c);
      params_t *p = calloc(1, sizeof(params_t));
      p->n = n;
      p->dominance = cases[c].dominance;
      p->equalization = cases[c].equalization;
      int hist[HISTN];
      capture_histogram(src, w, h, hist);
      invert_histogram(hist, p->source_ihist);
      kmeans(src, w, h, n, p->source_mean, p->source_var, p->source_weight);
      capture_histogram(tgt, w, h, p->target_hist);
      kmeans(tgt, w, h, n, p->target_mean, p->target_var, p->target_weight);
      float *out = malloc(sizeof(float) * 4 * w * h);
      process(p, tgt, out, w, h, cases[c].sigma_s);
      sep();
      printf("{\"name\":\"%s\",\"w\":%d,\"h\":%d,\"n\":%d,\"dominance\":", cases[c].name, w, h, n);
      fl(cases[c].dominance);
      printf(",\"equalization\":");
      fl(cases[c].equalization);
      printf(",\"sigmaS\":");
      fl(cases[c].sigma_s);
      printf(",\"source\":");
      print_image(src, w, h);
      printf(",\"target\":");
      print_image(tgt, w, h);
      printf(",\"out\":");
      print_image(out, w, h);
      printf("}");
      free(out);
      free(p);
      free(src);
      free(tgt);
    }
  }
  printf("]}\n");
  return 0;
}
