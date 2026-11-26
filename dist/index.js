//#region src/lab.ts
var e = [
	[
		.4360747,
		.3850649,
		.1430804
	],
	[
		.2225045,
		.7168786,
		.0606169
	],
	[
		.0139322,
		.0971045,
		.7141733
	]
];
function t(e) {
	let [t, n, r] = e, i = t[0] * (n[1] * r[2] - n[2] * r[1]) - t[1] * (n[0] * r[2] - n[2] * r[0]) + t[2] * (n[0] * r[1] - n[1] * r[0]);
	return [
		[
			(n[1] * r[2] - n[2] * r[1]) / i,
			(t[2] * r[1] - t[1] * r[2]) / i,
			(t[1] * n[2] - t[2] * n[1]) / i
		],
		[
			(n[2] * r[0] - n[0] * r[2]) / i,
			(t[0] * r[2] - t[2] * r[0]) / i,
			(t[2] * n[0] - t[0] * n[2]) / i
		],
		[
			(n[0] * r[1] - n[1] * r[0]) / i,
			(t[1] * r[0] - t[0] * r[1]) / i,
			(t[0] * n[1] - t[1] * n[0]) / i
		]
	];
}
var n = t(e), r = 24389 / 27, i = 216 / 24389, a = [
	.9642,
	1,
	.8249
], o = (e) => e > .008856451679035631 ? Math.cbrt(e) : (r * e + 16) / 116, s = (e) => e > 6 / 29 ? e * e * e : (116 * e - 16) / r, c = (e, t) => [
	e[0][0] * t[0] + e[0][1] * t[1] + e[0][2] * t[2],
	e[1][0] * t[0] + e[1][1] * t[1] + e[1][2] * t[2],
	e[2][0] * t[0] + e[2][1] * t[1] + e[2][2] * t[2]
];
function l(t) {
	let n = c(e, t), r = o(n[0] / a[0]), i = o(n[1]), s = o(n[2] / a[2]);
	return [
		116 * i - 16,
		500 * (r - i),
		200 * (i - s)
	];
}
function u(e) {
	let t = (e[0] + 16) / 116, r = t + e[1] / 500, i = t - e[2] / 200;
	return c(n, [
		s(r) * a[0],
		s(t),
		s(i) * a[2]
	]);
}
function d(e) {
	let t = new Float32Array(e.length);
	for (let n = 0; n < e.length; n += 4) {
		let [r, i, a] = l([
			e[n],
			e[n + 1],
			e[n + 2]
		]);
		t[n] = r, t[n + 1] = i, t[n + 2] = a, t[n + 3] = 1;
	}
	return t;
}
var f = (e) => {
	let t = Math.min(Math.max(e, 0), 1);
	return t <= .0031308 ? 12.92 * t : 1.055 * t ** (1 / 2.4) - .055;
};
function p(e) {
	return `rgb(${u(e).map((e) => Math.round(255 * f(e))).join(", ")})`;
}
//#endregion
//#region src/model.ts
var m = 2048, h = {
	on: !1,
	clusters: 3,
	dominance: 100,
	equalization: 50
}, g = {
	clusters: {
		min: 1,
		max: 5,
		step: 1
	},
	dominance: {
		min: 0,
		max: 100,
		step: 1
	},
	equalization: {
		min: 0,
		max: 100,
		step: 1
	}
}, _ = Math.fround, v = 34028234663852886e22, ee = (e, t, n) => e > n ? n : e < t ? t : e, te = 625341585;
function ne() {
	let e = te;
	return () => {
		e = e + 1831565813 >>> 0;
		let t = Math.imul(e ^ e >>> 15, e | 1) >>> 0;
		return t = (t ^ t + Math.imul(t ^ t >>> 7, t | 61)) >>> 0, t = (t ^ t >>> 14) >>> 0, (t >>> 8) * 2 ** -24;
	};
}
function re(e, t, n = 4) {
	let r = new Int32Array(m);
	for (let i = 0; i < t; i++) {
		let t = Math.trunc(ee(m * _(e[i * n]) / 100, 0, 2047));
		r[t]++;
	}
	for (let e = 1; e < m; e++) r[e] += r[e - 1];
	let i = _(m / _(r[2047]));
	for (let e = 0; e < m; e++) r[e] = Math.trunc(ee(_(_(r[e]) * i), 0, 2047));
	return r;
}
function ie(e) {
	let t = new Int32Array(m), n = 31;
	for (let e = 0; e <= n; e++) t[e] = e;
	for (let r = n + 1; r < m; r++) for (let i = n; i < m; i++) if (e[i] >= r) {
		n = i, t[r] = i;
		break;
	}
	return t;
}
function* ae(e, t, n, r = 4) {
	let i = new Float32Array(2 * n), a = new Float32Array(2 * n), o = new Float32Array(n), s = new Float32Array(2 * n), c = new Float32Array(2 * n), l = new Int32Array(n), u = v, d = v, f = -34028234663852886e22, p = -34028234663852886e22;
	for (let n = 0; n < t; n++) {
		let t = e[n * r + 1], i = e[n * r + 2];
		t < u && (u = t), t > f && (f = t), i < d && (d = i), i > p && (p = i);
	}
	let m = ne();
	for (let e = 0; e < n; e++) i[2 * e] = _(_(.9) * _(u + _(_(f - u) * m()))), i[2 * e + 1] = _(_(.9) * _(d + _(_(p - d) * m())));
	for (let u = 0; u < 40; u++) {
		s.fill(0), c.fill(0), l.fill(0);
		for (let a = 0; a < t; a++) {
			let t = e[a * r + 1], o = e[a * r + 2], u = v, d = 0;
			for (let e = 0; e < n; e++) {
				let n = _(t - i[2 * e]), r = _(o - i[2 * e + 1]), a = _(_(n * n) + _(r * r));
				a < u && (u = a, d = e);
			}
			l[d]++, c[2 * d] = _(c[2 * d] + _(t * t)), c[2 * d + 1] = _(c[2 * d + 1] + _(o * o)), s[2 * d] = _(s[2 * d] + t), s[2 * d + 1] = _(s[2 * d + 1] + o);
		}
		for (let e = 0; e < n; e++) if (l[e] !== 0) for (let t = 0; t < 2; t++) {
			let n = _(s[2 * e + t] / l[e]);
			i[2 * e + t] = n, a[2 * e + t] = _(_(c[2 * e + t] / l[e]) - _(n * n));
		}
		let u = 0;
		for (let e = 0; e < n; e++) u += l[e];
		for (let e = 0; e < n; e++) o[e] = u > 0 ? _(l[e] / u) : 0;
		yield;
	}
	let h = [];
	for (let e = 0; e < n; e++) {
		let t = [i[2 * e], i[2 * e + 1]], n = [a[2 * e], a[2 * e + 1]], r = o[e];
		(n[0] === 0 || n[1] === 0) && (t = [0, 0], n = [0, 0], r = 0);
		let s = n.map((e) => _(Math.sqrt(e > 0 ? e : 0)));
		h.push({
			mean: t,
			sd: s,
			weight: r
		});
	}
	for (let e = 0; e < n - 1; e++) for (let t = 0; t < n - 1 - e; t++) h[t].weight > h[t + 1].weight && ([h[t], h[t + 1]] = [h[t + 1], h[t]]);
	return {
		mean: h.flatMap((e) => e.mean),
		sd: h.flatMap((e) => e.sd),
		weight: h.map((e) => e.weight)
	};
}
var oe = (e) => e.weight.some((e) => e > 0);
//#endregion
//#region src/encoding.ts
function se(e) {
	if (e.length !== 2048) throw Error(`a table has ${m} entries, not ${e.length}`);
	let t = [], n = 0;
	for (let r = 0; r < m; r++) {
		let i = e[r];
		if (!Number.isInteger(i) || i < n || i >= 2048) throw Error(`entry ${r} (${i}) is out of order or range`);
		let a = i - n;
		for (n = i; a >= 128;) t.push(a & 127 | 128), a >>>= 7;
		t.push(a);
	}
	return Uint8Array.from(t);
}
function ce(e) {
	let t = new Int32Array(m), n = 0, r = 0;
	for (let i = 0; i < m; i++) {
		let a = 0, o = 0;
		for (;;) {
			if (n >= e.length || o > 14) return null;
			let t = e[n++];
			if (a |= (t & 127) << o, o += 7, t < 128) break;
		}
		if (r += a, r >= 2048) return null;
		t[i] = r;
	}
	return n === e.length ? t : null;
}
function le(e) {
	let t = "";
	for (let n of se(e)) t += String.fromCharCode(n);
	return btoa(t);
}
function y(e) {
	if (typeof e != "string" || e.length === 0) return null;
	let t;
	try {
		t = atob(e);
	} catch {
		return null;
	}
	return ce(Uint8Array.from(t, (e) => e.charCodeAt(0)));
}
function ue(e, t) {
	let n = t;
	for (let t = 0; t < e.length; t++) n = Math.imul(n ^ e.charCodeAt(t), 16777619) >>> 0;
	return n;
}
function b(e) {
	let t = (e) => e.toString(16).padStart(8, "0");
	return `s${t(ue(e, 2166136261))}${t(ue(e, 84696351))}`;
}
function de(e, t) {
	let n = new Float32Array(m);
	for (let t = 0; t < m; t++) n[t] = (e[t] + 1) / m;
	return {
		data: n,
		width: m,
		height: 1,
		format: "r16f",
		version: t
	};
}
//#endregion
//#region src/grid.ts
var x = Math.fround, S = 3e3, fe = 1.25, pe = 1024, me = (e) => Math.floor(e + .5), he = (e, t, n) => Math.min(Math.max(e, t), n);
function ge(e, t, n, r) {
	let i = x(n) < .5 ? .5 : x(n), a = he(me(x(e / i)), 4, S), o = he(me(x(t / i)), 4, S), s = he(me(x(100 / x(r))), 4, 50), c = Math.max(x(t / o), x(e / a)), l = x(100 / s), u = x(1 / c), d = x(1 / l), f = Math.ceil(x(e * u)) + 1, p = Math.ceil(x(t * u)) + 1, m = Math.ceil(x(100 * d)) + 1;
	return {
		sigmaS: c,
		sigmaR: l,
		invS: u,
		invR: d,
		sizeX: f,
		sizeY: p,
		sizeZ: m,
		quads: Math.ceil(m / 4)
	};
}
var _e = (e) => Math.floor(2 * e) + 4, ve = (e) => Math.ceil(_e(e) / 24), ye = (e, t) => 1 + e * (2 * t + 1) + 2, be = ge(4096, 4096, 50, 8).quads, xe = Math.min(ye(be, ve(62.5)), pe), C = "colour-mapping", w = `${C}.lab`, Se = `${C}.panel`, Ce = `${C}.match`, T = "Colour Mapping", we = [
	"on",
	"clusters",
	"dominance",
	"equalization"
], Te = [
	"clusters",
	"dominance",
	"equalization"
], E = "blDraws", D = {
	mean: "sMean",
	sd: "sVar",
	weight: "sWeight"
}, O = {
	mean: "tMean",
	sd: "tVar",
	weight: "tWeight"
}, k = "sourceHist", A = "sihist", j = "thist", Ee = [k, A], De = "thist", Oe = "analysis", M = {
	on: "Enabled",
	clusters: "Clusters",
	dominance: "Colour dominance",
	equalization: "Histogram equalisation"
}, N = (e) => `${w}.${e}`, P = (e) => typeof e == "number" && Number.isFinite(e);
function ke(e, t) {
	let n = Array(t).fill(0);
	if (!Array.isArray(e)) return n;
	for (let r = 0; r < t && r < e.length; r++) {
		let t = e[r];
		P(t) && (n[r] = t);
	}
	return n;
}
var Ae = (e, t) => ({
	mean: ke(e[N(t.mean)], 10),
	sd: ke(e[N(t.sd)], 10),
	weight: ke(e[N(t.weight)], 5)
});
function F(e) {
	let t = { ...h }, n = e[N("on")];
	typeof n == "boolean" ? t.on = n : P(n) && (t.on = n >= .5);
	for (let n of Te) {
		let r = e[N(n)];
		P(r) && (t[n] = Math.min(Math.max(r, g[n].min), g[n].max));
	}
	t.clusters = Math.round(t.clusters);
	let r = e[N(k)];
	return {
		...t,
		source: Ae(e, D),
		target: Ae(e, O),
		sourceHist: typeof r == "string" ? r : ""
	};
}
var je = (e) => Math.fround(e / 100) > Math.fround(.001), Me = (e) => e.on && je(e.equalization) && oe(e.source) && oe(e.target) ? xe : 0, I = (e, t) => Array.from({ length: t }, (t, n) => n < e.length ? e[n] : 0);
function L(e, t) {
	return {
		[N(t.mean)]: I(e.mean, 10),
		[N(t.sd)]: I(e.sd, 10),
		[N(t.weight)]: I(e.weight, 5)
	};
}
function Ne(e, t) {
	let n = {};
	for (let r of t) n[N(r)] = e[r];
	return n[N(E)] = Me(e), n;
}
function R(e, t, n) {
	let r = {
		...e,
		on: !0,
		clusters: t.n,
		source: t.clusters,
		target: n,
		sourceHist: t.hist
	};
	return {
		[N("on")]: !0,
		[N("clusters")]: t.n,
		...L(t.clusters, D),
		[N(k)]: t.hist,
		[N(A)]: b(t.hist),
		...L(n, O),
		[N(E)]: Me(r)
	};
}
var Pe = {
	mean: [],
	sd: [],
	weight: []
};
function Fe(e) {
	return {
		[N("clusters")]: e,
		[N("on")]: !1,
		...L(Pe, D),
		...L(Pe, O),
		[N(k)]: "",
		[N(A)]: "",
		[N(E)]: 0
	};
}
var Ie = () => ({
	...Fe(h.clusters),
	[N("dominance")]: h.dominance,
	[N("equalization")]: h.equalization
}), Le = [
	...we,
	E,
	...Object.values(D),
	...Object.values(O)
];
function Re(e) {
	if (!Le.some((t) => N(t) in e)) return null;
	let t = Me(F(e)), n = e[N(E)];
	return (P(n) ? n : 0) === t ? null : { [N(E)]: t };
}
//#endregion
//#region src/rt.ts
var z, B;
function ze(e) {
	B = e, z = e.react;
}
//#endregion
//#region src/store.ts
var V = "source", H = (e, t) => Array.isArray(e) && e.length === t && e.every((e) => typeof e == "number" && Number.isFinite(e));
function Be(e) {
	if (typeof e != "object" || !e) return null;
	let t = e, n = t.n;
	if (typeof n != "number" || !Number.isInteger(n) || n < 1 || n > 5 || typeof t.photoId != "string" || typeof t.name != "string" || typeof t.hist != "string" || y(t.hist) === null) return null;
	let r = t.clusters;
	if (typeof r != "object" || !r) return null;
	let { mean: i, sd: a, weight: o } = r;
	return !H(i, 2 * n) || !H(a, 2 * n) || !H(o, n) ? null : {
		photoId: t.photoId,
		name: t.name,
		n,
		hist: t.hist,
		clusters: {
			mean: i,
			sd: a,
			weight: o
		}
	};
}
function Ve(e) {
	if (typeof e != "object" || !e) return null;
	let { photoId: t, name: n } = e;
	return typeof t == "string" && typeof n == "string" ? {
		photoId: t,
		name: n
	} : null;
}
var U = null;
function He() {
	U = B.stores.create()((e) => ({
		source: Be(B.settings.get(V, null)),
		busy: null,
		reference: null,
		setSource: (t) => e({ source: t }),
		setReference: (t) => e({ reference: t }),
		setBusy: (t) => e({ busy: t })
	}));
}
function W() {
	if (!U) throw Error("Colour Mapping's store is used before activate()");
	return U;
}
//#endregion
//#region src/analysis.ts
var Ue = {
	[N("on")]: !1,
	[N(A)]: Oe,
	[N(j)]: Oe
}, We = {
	point: "pre-output",
	space: {
		encoding: "linear",
		primaries: "rec709"
	}
}, Ge = () => new Promise((e) => setTimeout(e, 0));
async function G(e, t) {
	let n = e.width * e.height, r = d(e.data), i = re(r, n), a = ae(r, n, t);
	for (;;) {
		let e = a.next();
		if (e.done) return {
			hist: i,
			clusters: e.value
		};
		await Ge();
	}
}
var Ke = (e, t) => ({
	n: e,
	clusters: t.clusters,
	hist: le(ie(t.hist))
}), qe = `${T}: match to source`, Je = `${T}: match to reference`, Ye = "reference.photo", Xe = null;
function Ze(e) {
	Xe = e;
	let t = W().getState().source;
	t && e.rememberSource(t.hist);
}
function Qe() {
	if (!Xe) throw Error("Colour Mapping's workflow is used before activate()");
	return Xe;
}
var K = () => B.stores.useDevelopStore.getState(), $e = (e) => B.stores.useCatalogStore.getState().photos.find((t) => t.id === e)?.filename ?? "the source photo";
async function et(e) {
	let t = await B.develop.captureFloatFrame(K().params, {
		...We,
		paramBag: { ...Ue },
		maxEdge: 640
	});
	return t && K().photoId === e ? t : null;
}
async function q(e, t) {
	if (!W().getState().busy) {
		W().getState().setBusy(e);
		try {
			return await t();
		} catch (e) {
			console.warn("[colour-mapping]", e), B.ui.notify({
				message: `${T} couldn't analyse the photo.`,
				tone: "error"
			});
			return;
		} finally {
			W().getState().setBusy(null);
		}
	}
}
function tt() {
	return q("source", async () => {
		let e = K().photoId;
		if (!e) return;
		let t = F(K().paramBag).clusters, n = await et(e);
		if (!n) return;
		let r = {
			...Ke(t, await G(n, t)),
			photoId: e,
			name: $e(e)
		};
		Qe().rememberSource(r.hist), B.settings.set(V, r), W().getState().setSource(r);
	});
}
async function nt(e, t, n, r) {
	let i = Qe();
	i.setTarget(e, n.hist), B.develop.putPhotoData(De, se(n.hist), r ? void 0 : e);
	let a = i.rememberSource(t.hist);
	r && await Promise.all([B.prepareStageTextureVariant(w, A, a).catch(() => void 0), B.prepareStageTextureVariant(w, j, e).catch(() => void 0)]);
}
async function rt(e, t, n) {
	let r = await et(e);
	if (!r) return;
	let i = await G(r, t.n);
	K().photoId === e && (await nt(e, t, i, !0), K().photoId === e && (K().setDynParams(R(F(K().paramBag), t, i.clusters)), await K().commitEdit(n)));
}
function it() {
	return q("match", async () => {
		let e = W().getState().source, t = K().photoId;
		e && t && await rt(t, e, qe);
	});
}
function at() {
	return q("match", async () => {
		let e = W().getState().reference, t = K().photoId;
		if (!e || !t || e.photoId === t) return;
		let n = F(K().paramBag).clusters, { params: r, bag: i } = await ot(e.photoId), a = await B.develop.renderPhotoFloatFrame(e.photoId, r, {
			...We,
			paramBag: {
				...i,
				...Ue
			}
		});
		if (!a || K().photoId !== t) return;
		let o = {
			...Ke(n, await G(a, n)),
			photoId: e.photoId,
			name: e.name
		};
		Qe().rememberSource(o.hist), B.settings.set(V, o), W().getState().setSource(o), await rt(t, o, Je);
	});
}
async function ot(e) {
	let t = await B.catalog.getEditState(e), n = t && t.stack.length > 0 ? t.stack[Math.min(Math.max(t.currentIndex, 0), t.stack.length - 1)] : null;
	if (n) return {
		params: n.params,
		bag: n.paramBag ?? {}
	};
	let r = B.stores.useCatalogStore.getState().photos.find((t) => t.id === e);
	return {
		params: B.develop.normalizeParams({ temperature: r?.exif.colorTemperature }),
		bag: {}
	};
}
async function st(e, t) {
	let { params: n, bag: r } = K().photoId === e ? {
		params: K().params,
		bag: K().paramBag
	} : await ot(e), i = await B.develop.renderPhotoFloatFrame(e, n, {
		...We,
		paramBag: {
			...r,
			...Ue
		}
	});
	if (!i) return !1;
	let a = await G(i, t.n), o = K().photoId === e;
	return await nt(e, t, a, o), o && K().photoId === e ? (K().setDynParams(R(F(K().paramBag), t, a.clusters)), await K().commitEdit(qe)) : await B.catalog.applyBagPatch(e, R(F(r), t, a.clusters), qe), !0;
}
var J = (e) => e === 1 ? "1 photo" : `${e} photos`;
function ct(e) {
	return q("batch", async () => {
		let t = W().getState().source;
		if (!t || e.length === 0) return;
		let n = B.ui.notify({
			message: `Matching ${J(e.length)} to ${t.name}`,
			progress: 0
		}), r = 0;
		for (let [i, a] of e.entries()) {
			try {
				await st(a, t) || r++;
			} catch (e) {
				console.warn(`[colour-mapping] ${a}:`, e), r++;
			}
			n.update({ progress: (i + 1) / e.length });
		}
		let i = e.length - r;
		n.update({
			message: r === 0 ? `Matched ${J(i)} to ${t.name}` : `Matched ${J(i)}; ${J(r)} couldn't be read`,
			tone: r === 0 ? "success" : "warning",
			progress: null
		});
	});
}
//#endregion
//#region src/Panel.tsx
var lt = {
	on: "Switch the colour transfer on or off",
	clusters: "Number of clusters to find in the photo. Changing it resets all clusters",
	dominance: "How clusters are mapped, in percent. Low values: based on colour proximity, high values: based on colour dominance",
	equalization: "Level of histogram equalisation, in percent"
}, ut = "The colour source's clusters: each block is one cluster, its average colour in the centre and its spread around it", dt = "This photo's clusters, as the last match found them", ft = 53.390011;
function pt({ clusters: e, n: t, title: n }) {
	let { tokens: r } = B.ui, i = [];
	for (let n = 0; n < t; n++) {
		let t = [];
		for (let r = -1; r <= 1; r++) for (let i = -1; i <= 1; i++) {
			let a = e.mean[2 * n] + i * e.sd[2 * n], o = e.mean[2 * n + 1] + r * e.sd[2 * n + 1];
			t.push(/* @__PURE__ */ z.createElement("div", {
				key: `${i},${r}`,
				"data-swatch": "",
				style: { background: p([
					ft,
					a,
					o
				]) }
			}));
		}
		i.push(/* @__PURE__ */ z.createElement("div", {
			key: n,
			style: {
				flex: 1,
				display: "grid",
				gridTemplateColumns: "repeat(3, 1fr)",
				gridTemplateRows: "repeat(3, 1fr)",
				gap: 1
			}
		}, t));
	}
	return /* @__PURE__ */ z.createElement("div", {
		title: n,
		style: {
			display: "flex",
			gap: 2,
			padding: 4,
			aspectRatio: "3 / 1",
			background: r.surface2,
			borderRadius: 4
		}
	}, i);
}
var Y = () => B.stores.useDevelopStore.getState();
function mt(e, t) {
	Y().setDynParams(Ne(e, t));
}
var ht = (e) => void Y().commitEdit(`${T}: ${e}`);
function gt() {
	let { Slider: e } = B.components, { Button: t, Field: n, Row: r, Stack: i, Toggle: a } = B.ui, o = B.stores.useDevelopStore((e) => e.paramBag), s = B.stores.useDevelopStore((e) => e.photoId), c = W()((e) => e.source), l = W()((e) => e.busy), u = W()((e) => e.reference), d = F(o), f = d.source.weight.some((e) => e > 0), p = (t, n) => {
		let r = g[t];
		return /* @__PURE__ */ z.createElement("div", {
			key: t,
			title: lt[t]
		}, /* @__PURE__ */ z.createElement(e, {
			label: M[t],
			value: d[t],
			min: r.min,
			max: r.max,
			step: r.step,
			defaultValue: h[t],
			onChange: n,
			onCommit: () => ht(M[t].toLowerCase())
		}));
	}, m = (e) => (t) => {
		mt({
			...F(Y().paramBag),
			[e]: Math.min(Math.max(t, g[e].min), g[e].max),
			on: !0
		}, [e, "on"]);
	}, _ = (e) => {
		let t = Math.min(Math.max(Math.round(e), g.clusters.min), g.clusters.max);
		t !== F(Y().paramBag).clusters && Y().setDynParams(Fe(t));
	}, v = c ? `Analyse this photo and match its colours to ${c.name}` : "Use a photo as the colour source first";
	return /* @__PURE__ */ z.createElement(i, {
		gap: 6,
		style: { padding: 8 }
	}, /* @__PURE__ */ z.createElement("div", { title: lt.on }, /* @__PURE__ */ z.createElement(a, {
		checked: d.on,
		label: M.on,
		onChange: (e) => {
			mt({
				...F(Y().paramBag),
				on: e
			}, ["on"]), ht(e ? "on" : "off");
		}
	})), /* @__PURE__ */ z.createElement(n, { label: "Source clusters" }, /* @__PURE__ */ z.createElement(pt, {
		clusters: f || !c ? d.source : c.clusters,
		n: f || !c ? d.clusters : c.n,
		title: ut
	})), /* @__PURE__ */ z.createElement(n, { label: "Target clusters" }, /* @__PURE__ */ z.createElement(pt, {
		clusters: d.target,
		n: d.clusters,
		title: dt
	})), /* @__PURE__ */ z.createElement(r, { gap: 6 }, /* @__PURE__ */ z.createElement(t, {
		size: "sm",
		full: !0,
		disabled: !s || l !== null,
		title: "Analyse this photo as the colour source",
		onClick: () => void tt()
	}, l === "source" ? "Analysing…" : "Use as source"), /* @__PURE__ */ z.createElement(t, {
		size: "sm",
		full: !0,
		disabled: !s || !c || l !== null,
		title: v,
		onClick: () => void it()
	}, l === "match" ? "Analysing…" : "Match to source")), u && s && u.photoId !== s && /* @__PURE__ */ z.createElement(t, {
		size: "sm",
		full: !0,
		disabled: l !== null,
		title: `Use ${u.name} as the colour source and match this photo to it`,
		onClick: () => void at()
	}, "Match to reference"), p("clusters", _), p("dominance", m("dominance")), p("equalization", m("equalization")));
}
function _t() {
	Y().setDynParams(Ie()), ht("reset");
}
//#endregion
//#region src/glsl.ts
function vt(e) {
	let t = e.toPrecision(10);
	if (/e/i.test(t)) {
		let [e, n] = t.split(/e/i);
		return `${e.includes(".") ? e : `${e}.0`}e${Number(n)}`;
	}
	return t.includes(".") ? t.replace(/0+$/, "").replace(/\.$/, ".0") : `${t}.0`;
}
var X = vt, yt = (e) => `mat3(${[
	0,
	1,
	2
].flatMap((t) => [
	0,
	1,
	2
].map((n) => X(e[n][t]))).join(", ")})`, bt = `vec3(${a.map(X).join(", ")})`, xt = `
float cmCbrt(float v) {
  float r = exp2(log2(v) / 3.0);
  return r - (r * r * r - v) / (3.0 * r * r);
}
float cmLabF(float t) {
  return t > ${X(i)} ? cmCbrt(t) : (${X(r)} * t + 16.0) / 116.0;
}
`, St = `${xt}
float cmLightness(vec3 rgb) {
  return 116.0 * cmLabF(dot(vec3(${e[1].map(X).join(", ")}), rgb)) - 16.0;
}
`, Ct = `
float cmBin(float L) {
  float q = floor(L * ${X(m / 100)});
  if (L < q * ${X(100 / m)}) q -= 1.0;
  else if (L >= (q + 1.0) * ${X(100 / m)}) q += 1.0;
  return min(max(q, 0.0), ${X(m - 1)});
}
float cmShift(float L) {
  float t = texelFetch(${j}, ivec2(int(cmBin(L)), 0), 0).r * ${X(m)} - 1.0;
  if (t < 0.0) return -1.0;
  float k = texelFetch(${A}, ivec2(int(t), 0), 0).r * ${X(m)} - 1.0;
  if (k < 0.0) return -1.0;
  float e = equalization / 100.0;
  float ih = k * 100.0 / ${X(m)};
  return min(max(0.5 * ((L * (1.0 - e) + ih * e) - L) + 50.0, 0.0), 100.0);
}
`, wt = `${xt}${Ct}
float cmLabFInv(float f) {
  return f > ${X(6 / 29)} ? f * f * f : (116.0 * f - 16.0) / ${X(r)};
}
vec3 cmToLab(vec3 rgb) {
  vec3 xyz = ${yt(e)} * rgb / ${bt};
  vec3 f = vec3(cmLabF(xyz.x), cmLabF(xyz.y), cmLabF(xyz.z));
  return vec3(116.0 * f.y - 16.0, 500.0 * (f.x - f.y), 200.0 * (f.y - f.z));
}
vec3 cmFromLab(vec3 lab) {
  float fy = (lab.x + 16.0) / 116.0;
  vec3 f = vec3(fy + lab.y / 500.0, fy, fy - lab.z / 200.0);
  vec3 xyz = vec3(cmLabFInv(f.x), cmLabFInv(f.y), cmLabFInv(f.z)) * ${bt};
  return ${yt(n)} * xyz;
}
// get_clusters(): the pixel's share of target cluster c, unnormalized, by
// inverse squared distance; a cluster it sits on takes it whole.
float cmShare(vec2 ab, int c, bool hit) {
  vec2 t = ab - tMean[c];
  float d2 = dot(t, t);
  if (hit) return d2 > 1.0e-6 ? 0.0 : 1.0;
  return d2 > 1.0e-6 ? 1.0 / d2 : -1.0;
}
// The pixel through the mapping: L* by the histograms, smoothed by the pass's
// shift when it ran, a* and b* by each target cluster's paired source cluster
// (get_cluster_mapping), weighted by the pixel's share of it. Passes the pixel
// through until both sides hold clusters and both tables are there.
vec3 cmTransfer(vec3 rgb, bool smoothed, float delta) {
  int n = clamp(clusters, 1, 5);
  float sourceTotal = 0.0;
  float targetTotal = 0.0;
  for (int k = 0; k < 5; k++) {
    if (k < n) {
      sourceTotal += sWeight[k];
      targetTotal += tWeight[k];
    }
  }
  if (!(sourceTotal > 0.0) || !(targetTotal > 0.0)) return rgb;
  vec3 lab = cmToLab(rgb);
  float D = cmShift(lab.x);
  if (D < 0.0) return rgb;
  if (smoothed) D = max(0.0, D + delta);
  float L = min(max(2.0 * (D - 50.0) + lab.x, 0.0), 100.0);

  float nearest = 3.4e38;
  for (int k = 0; k < 5; k++) {
    if (k < n) {
      vec2 t = lab.yz - tMean[k];
      nearest = min(nearest, dot(t, t));
    }
  }
  bool hit = nearest < 1.0e-6;
  float total = 0.0;
  for (int k = 0; k < 5; k++) {
    if (k < n) total += cmShare(lab.yz, k, hit);
  }

  float d = dominance / 100.0;
  vec2 ab = vec2(0.0);
  for (int c = 0; c < 5; c++) {
    if (c < n) {
      float w = cmShare(lab.yz, c, hit);
      if (total > 0.0) w /= total;
      float best = 3.4e38;
      vec2 pairedMean = sMean[0];
      vec2 pairedSd = sVar[0];
      for (int k = 0; k < 5; k++) {
        if (k < n) {
          vec2 dm = sMean[k] - tMean[c];
          float dw = sWeight[k] - tWeight[c];
          float dist = dot(dm, dm) * (1.0 - d) + 10000.0 * dw * dw * d;
          if (dist < best) {
            best = dist;
            pairedMean = sMean[k];
            pairedSd = sVar[k];
          }
        }
      }
      vec2 sd = tVar[c];
      vec2 ratio = vec2(sd.x > 0.0 ? pairedSd.x / sd.x : 0.0, sd.y > 0.0 ? pairedSd.y / sd.y : 0.0);
      ab += w * ((lab.yz - tMean[c]) * ratio + pairedMean);
    }
  }
  return cmFromLab(vec3(L, ab));
}
`, Tt = "\nif (on) {\n  c.rgb = cmTransfer(c.rgb, blDraws > 0, blDraws > 0 ? stageResult.x + stageResult.y : 0.0);\n}\n", Z = {
	idle: 0,
	plan: 1,
	splatX: 2,
	splatY: 3,
	blurX: 4,
	blurY: 5,
	slice: 6,
	zero: 7
}, Et = `
precision highp int;
${`
float cmQuantize(float v) {
  if (abs(v) < ${X(2 ** -14)}) return 0.0;
  return uintBitsToFloat((floatBitsToUint(v) + 0x1000u) & 0xFFFFE000u);
}
float cmHalf(float v) {
  if (abs(v) < ${X(2 ** -14)}) return floor(v * ${X(2 ** 24)} + 0.5) * ${X(2 ** -24)};
  return cmQuantize(v);
}
vec4 cmHalf4(vec4 v) { return vec4(cmHalf(v.x), cmHalf(v.y), cmHalf(v.z), cmHalf(v.w)); }
`}${St}${Ct}
// 2^e for a normal result; ldexp is GLSL ES 3.10.
float cmPow2(int e) { return uintBitsToFloat(uint(e + 127) << 23); }
ivec2 cmFrame() { return ivec2(floor(1.0 / uTexel + 0.5)); }
ivec2 cmAt(highp int n, int width) {
  highp int row = n / width;
  return ivec2(n - row * width, row);
}
vec4 cmFetch(highp int n, int width) { return fetchPrev4(cmAt(n, width)); }
vec4 cmOneHot(int i) { return vec4(equal(ivec4(i), ivec4(0, 1, 2, 3))); }
// The texels [from, to) as whole rows.
ivec4 cmRows(int width, highp int from, highp int to) {
  if (to <= from) return ivec4(0);
  return ivec4(0, from / width, width, (to - 1) / width + 1);
}
// The last draw hands the inline the smoothed shift as a half float in x and
// what that leaves in y.
vec4 cmResult(float delta) {
  float hi = cmQuantize(delta);
  return vec4(hi, cmHalf(delta - hi), 0.0, 1.0);
}
// D at a texel of the stage's input, 50 (no shift) while a table is missing.
float cmGridValue(ivec2 texel) {
  float D = cmShift(cmLightness(fetchInput(texel)));
  return D < 0.0 ? 50.0 : D;
}
// a / b correctly rounded, for positive normal floats: a GPU's division
// needn't be, and the grid's sizes come out of these at whole numbers.
float cmDiv(float a, float b) {
  uint ua = floatBitsToUint(a);
  uint ub = floatBitsToUint(b);
  int e = int(ua >> 23) - int(ub >> 23);
  uint ma = (ua & 0x7FFFFFu) | 0x800000u;
  uint mb = (ub & 0x7FFFFFu) | 0x800000u;
  if (ma < mb) {
    ma <<= 1;
    e -= 1;
  }
  uint quotient = 0u;
  for (int i = 0; i < 25; i++) {
    quotient <<= 1;
    if (ma >= mb) {
      ma -= mb;
      quotient |= 1u;
    }
    ma <<= 1;
  }
  uint guard = quotient & 1u;
  quotient >>= 1;
  if (guard == 1u && (ma != 0u || (quotient & 1u) == 1u)) quotient += 1u;
  if (quotient == 0x1000000u) {
    quotient >>= 1;
    e += 1;
  }
  return float(quotient) * cmPow2(e - 23);
}
// roundf() of a non-negative value.
int cmRound(float v) {
  float whole = floor(v);
  return int(whole) + (v - whole >= 0.5 ? 1 : 0);
}
// A float32 as three 11-bit pieces of its mantissa and its exponent, all of
// which a half float holds exactly, and back.
vec4 cmPack(float v) {
  if (v == 0.0) return vec4(0.0);
  uint bits = floatBitsToUint(v);
  uint m = (bits & 0x7FFFFFu) | 0x800000u;
  return vec4(float(m >> 13), float((m >> 2) & 0x7FFu), float(m & 3u), float(int(bits >> 23) - 150));
}
float cmUnpack(vec4 s) {
  return float(uint(s.x) * 8192u + uint(s.y) * 4u + uint(s.z)) * cmPow2(int(s.w));
}
// dt_bilateral_grid_size(): sigma_s, sigma_r and their inverses.
vec4 cmGridSigmas(ivec2 frame, float sigmaS, float sigmaR) {
  float s = sigmaS < 0.5 ? 0.5 : sigmaS;
  int gx = clamp(cmRound(cmDiv(float(frame.x), s)), 4, ${S});
  int gy = clamp(cmRound(cmDiv(float(frame.y), s)), 4, ${S});
  int gz = clamp(cmRound(cmDiv(100.0, sigmaR)), 4, 50);
  float grid = max(cmDiv(float(frame.y), float(gy)), cmDiv(float(frame.x), float(gx)));
  float range = cmDiv(100.0, float(gz));
  return vec4(grid, cmDiv(1.0, grid), range, cmDiv(1.0, range));
}
ivec3 cmGridSize(ivec2 frame, vec4 sigmas) {
  return ivec3(int(ceil(float(frame.x) * sigmas.y)) + 1, int(ceil(float(frame.y) * sigmas.y)) + 1, int(ceil(100.0 * sigmas.w)) + 1);
}
highp int cmGridTexels(ivec2 frame, ivec3 size) {
  int quads = (size.z + 3) / 4;
  return 4 + size.x * frame.y + size.x * size.y * quads;
}
// σs of 50 pixels of the full image at this pass's scale, widened while
// darktable's grid wouldn't fit the target (x of the result 0 when nothing fits).
vec4 cmPlan(ivec2 frame) {
  float longest = float(max(frame.x, frame.y));
  float source = max(uSourceSize.x, uSourceSize.y);
  float s = max(source <= longest ? ${X(50)} : cmDiv(${X(50)}, cmDiv(source, longest)), 0.5);
  for (int k = 0; k < 16; k++) {
    vec4 sigmas = cmGridSigmas(frame, s, ${X(8)});
    if (cmGridTexels(frame, cmGridSize(frame, sigmas)) <= frame.x * frame.y) return sigmas;
    s *= ${X(fe)};
  }
  return vec4(0.0);
}
vec4 cmConstants() {
  return vec4(cmUnpack(fetchPrev4(ivec2(0, 0))), cmUnpack(fetchPrev4(ivec2(1, 0))), cmUnpack(fetchPrev4(ivec2(2, 0))), cmUnpack(fetchPrev4(ivec2(3, 0))));
}
int cmSpan(float sigmaS) { return int(floor(2.0 * sigmaS)) + 4; }
int cmChunks(float sigmaS) { return (cmSpan(sigmaS) + 23) / 24; }
int cmSteps(ivec3 size, float sigmaS) { return ((size.z + 3) / 4) * (2 * cmChunks(sigmaS) + 1) + 2; }
// The step draw k runs. Draw 0 plans the grid into the constant texels; the
// schedule ends at the last draw: for each quad of bins its x-splat, blurred
// along x in place, then its y-splat; the grid's blur along y, in place; the
// slice. darktable blurs the whole splat along x, then y: the same sums, as
// both are linear and act on one axis each.
void cmStep(int k, ivec2 frame, vec4 sigmas, out int kind, out int quad, out int chunk) {
  kind = ${Z.idle};
  quad = 0;
  chunk = 0;
  if (k == 0) {
    kind = ${Z.plan};
    return;
  }
  ivec3 size = cmGridSize(frame, sigmas);
  int steps = cmSteps(size, sigmas.x);
  if (sigmas.x == 0.0 || uPassCount < steps + 1) {
    if (k == uPassCount - 1) kind = ${Z.zero};
    return;
  }
  int s = k - (uPassCount - steps);
  if (s < 0) return;
  int chunks = cmChunks(sigmas.x);
  int perQuad = 2 * chunks + 1;
  int splats = steps - 2;
  if (s < splats) {
    quad = s / perQuad;
    int j = s - quad * perQuad;
    kind = j < chunks ? ${Z.splatX} : (j == chunks ? ${Z.blurX} : ${Z.splatY});
    chunk = j < chunks ? j : j - chunks - 1;
  } else {
    kind = s == splats ? ${Z.blurY} : ${Z.slice};
  }
}
// The texels [from, to) a step writes.
void cmStepRange(int kind, int quad, ivec2 frame, ivec3 size, out highp int from, out highp int to) {
  highp int sx = 4;
  highp int nodes = size.x * size.y;
  highp int grid = sx + size.x * frame.y;
  from = 0;
  to = 0;
  if (kind == ${Z.plan}) to = 4;
  if (kind == ${Z.splatX} || kind == ${Z.blurX}) {
    from = sx;
    to = grid;
  }
  if (kind == ${Z.splatY}) {
    from = grid + quad * nodes;
    to = from + nodes;
  }
  if (kind == ${Z.blurY}) {
    from = grid;
    to = grid + nodes * ((size.z + 3) / 4);
  }
}
ivec4 cmRegion() {
  ivec2 frame = cmFrame();
  if (uPassIndex == 0) return ivec4(0, 0, frame);
  vec4 sigmas = cmConstants();
  int kind, quad, chunk;
  cmStep(uPassIndex, frame, sigmas, kind, quad, chunk);
  if (kind == ${Z.idle}) return ivec4(0);
  if (kind == ${Z.slice} || kind == ${Z.zero}) return ivec4(0, 0, frame);
  ivec3 size = cmGridSize(frame, sigmas);
  highp int from, to, before, after;
  cmStepRange(kind, quad, frame, size, from, to);
  int prevKind, prevQuad, prevChunk;
  cmStep(uPassIndex - 1, frame, sigmas, prevKind, prevQuad, prevChunk);
  cmStepRange(prevKind, prevQuad, frame, size, before, after);
  if (after > before) {
    from = min(from, before);
    to = max(to, after);
  }
  return cmRows(frame.x, from, to);
}
// darktable's tent: a coordinate's weight to a node, the coordinate clamped
// to the grid and its whole part to size - 2 (image_to_grid()).
float cmTent(float coord, float inv, int size, int node) {
  float x = clamp(coord * inv, 0.0, float(size - 1));
  int xi = min(int(x), size - 2);
  float xf = x - float(xi);
  return xi == node ? 1.0 - xf : (xi + 1 == node ? xf : 0.0);
}
int cmFirst(int node, float sigmaS) { return max(int(floor(float(node - 1) * sigmaS)) - 1, 0); }
// One chunk of a node's x-splat of D in one row: four z bins.
vec4 cmSplatX(ivec2 frame, vec4 sigmas, ivec3 size, highp int rel, int quad, int chunk) {
  int gx = int(rel - (rel / size.x) * size.x);
  int y = int(rel / size.x);
  int first = cmFirst(gx, sigmas.x) + chunk * 24;
  int span = cmSpan(sigmas.x) - chunk * 24;
  vec4 sum = vec4(0.0);
  for (int t = 0; t < 24; t++) {
    int x = first + t;
    if (t < span && x < frame.x) {
      float w = cmTent(float(x), sigmas.y, size.x, gx);
      float z = clamp(cmGridValue(ivec2(x, y)) * sigmas.w, 0.0, float(size.z - 1));
      int zi = min(int(z), size.z - 2);
      float zf = z - float(zi);
      sum += w * ((1.0 - zf) * cmOneHot(zi - 4 * quad) + zf * cmOneHot(zi + 1 - 4 * quad));
    }
  }
  return sum;
}
// One chunk of a node's y-splat of the x-splats.
vec4 cmSplatY(ivec2 frame, vec4 sigmas, ivec3 size, highp int rel, int chunk) {
  int gx = int(rel - (rel / size.x) * size.x);
  int gy = int(rel / size.x);
  int first = cmFirst(gy, sigmas.x) + chunk * 24;
  int span = cmSpan(sigmas.x) - chunk * 24;
  vec4 sum = vec4(0.0);
  for (int t = 0; t < 24; t++) {
    int y = first + t;
    if (t < span && y < frame.y) {
      sum += cmTent(float(y), sigmas.y, size.y, gy) * cmFetch(4 + y * size.x + gx, frame.x);
    }
  }
  return sum;
}
float cmBlurWeight(int d) { return d == 0 ? 0.375 : (d == 1 || d == -1 ? 0.25 : 0.0625); }
// blur_line(): (1 4 6 4 1) / 16 along x (axis 0: a row of the x-splat) or y
// (a column of a quad of the grid), zero beyond the grid, read from the draw
// before and written in place.
vec4 cmBlur(ivec2 frame, ivec3 size, highp int from, highp int rel, int axis) {
  highp int nodes = size.x * size.y;
  highp int inQuad = rel - (rel / nodes) * nodes;
  int along = axis == 0 ? int(rel - (rel / size.x) * size.x) : int(inQuad / size.x);
  int count = axis == 0 ? size.x : size.y;
  highp int stride = axis == 0 ? 1 : size.x;
  vec4 sum = vec4(0.0);
  for (int d = -2; d <= 2; d++) {
    if (along + d >= 0 && along + d < count) sum += cmBlurWeight(d) * cmFetch(from + rel + d * stride, frame.x);
  }
  return sum;
}
// A grid node's six bins from zi - 2 on, as two vectors (x, y, z of the
// second unused past bin zi + 3), zero outside the grid.
void cmBins6(ivec2 frame, highp int grid, ivec3 size, int gx, int gy, int zi, out vec4 low, out vec2 high) {
  int quads = (size.z + 3) / 4;
  int q0 = (zi + 2) / 4 - 1;
  int o = zi - 2 - 4 * q0;
  highp int node = gy * size.x + gx;
  highp int nodes = size.x * size.y;
  vec4 v0 = q0 >= 0 ? cmFetch(grid + q0 * nodes + node, frame.x) : vec4(0.0);
  vec4 v1 = q0 + 1 < quads ? cmFetch(grid + (q0 + 1) * nodes + node, frame.x) : vec4(0.0);
  vec4 v2 = q0 + 2 < quads ? cmFetch(grid + (q0 + 2) * nodes + node, frame.x) : vec4(0.0);
  vec4 b = vec4(0.0);
  vec2 c2 = vec2(0.0);
  for (int d = 0; d < 6; d++) {
    int i = o + d;
    float v = dot(v0, cmOneHot(i)) + dot(v1, cmOneHot(i - 4)) + dot(v2, cmOneHot(i - 8));
    if (d < 4) b += v * cmOneHot(d);
    else c2 += v * cmOneHot(d - 4).xy;
  }
  low = b;
  high = c2;
}
// dt_bilateral_slice() with detail -1: the z derivative of the blurred grid,
// trilinear at the texel's D, scaled as darktable's splat weighs a pixel.
vec4 cmSlice(ivec2 frame, vec4 sigmas, ivec3 size, ivec2 q) {
  highp int grid = 4 + size.x * frame.y;
  float D = cmGridValue(q);
  float xs = clamp(float(q.x) * sigmas.y, 0.0, float(size.x - 1));
  float ys = clamp(float(q.y) * sigmas.y, 0.0, float(size.y - 1));
  float zs = clamp(D * sigmas.w, 0.0, float(size.z - 1));
  int xi = min(int(xs), size.x - 2);
  int yi = min(int(ys), size.y - 2);
  int zi = min(int(zs), size.z - 2);
  float xf = xs - float(xi);
  float yf = ys - float(yi);
  float zf = zs - float(zi);
  float sum = 0.0;
  for (int j = 0; j < 2; j++) {
    for (int i = 0; i < 2; i++) {
      vec4 low;
      vec2 high;
      cmBins6(frame, grid, size, xi + i, yi + j, zi, low, high);
      float d0 = 0.25 * (low.w - low.y) + 0.125 * (high.x - low.x);
      float d1 = 0.25 * (high.x - low.z) + 0.125 * (high.y - low.y);
      float w = (i == 1 ? xf : 1.0 - xf) * (j == 1 ? yf : 1.0 - yf);
      sum += w * ((1.0 - zf) * d0 + zf * d1);
    }
  }
  float norm = sigmas.z * 0.04;
  return cmResult(norm * (100.0 / (sigmas.x * sigmas.x)) * sum);
}
`, Q = {
	plan: "c = cmPack(dot(cmPlan(frame), cmOneHot(q.x)));",
	splatX: "c = cmHalf4((chunk == 0 ? vec4(0.0) : c) + cmSplatX(frame, sigmas, size, n - from, quad, chunk));",
	splatY: "c = cmHalf4((chunk == 0 ? vec4(0.0) : c) + cmSplatY(frame, sigmas, size, n - from, chunk));",
	blurX: "c = cmHalf4(cmBlur(frame, size, from, n - from, 0));",
	blurY: "c = cmHalf4(cmBlur(frame, size, from, n - from, 1));",
	slice: "c = cmSlice(frame, sigmas, size, q);"
}, Dt = `
ivec2 frame = cmFrame();
ivec2 q = ivec2(gl_FragCoord.xy);
if (uPassIndex == 0) {
  if (q.y == 0 && q.x < 4) ${Q.plan}
} else {
  vec4 sigmas = cmConstants();
  int kind, quad, chunk;
  cmStep(uPassIndex, frame, sigmas, kind, quad, chunk);
  ivec3 size = cmGridSize(frame, sigmas);
  if (kind == ${Z.zero}) {
    c = vec4(0.0, 0.0, 0.0, 1.0);
  } else if (kind == ${Z.slice}) {
    ${Q.slice}
  } else if (kind != ${Z.idle}) {
    highp int from, to;
    cmStepRange(kind, quad, frame, size, from, to);
    highp int n = q.y * frame.x + q.x;
    if (n >= from && n < to) {
      if (kind == ${Z.splatX}) {
        ${Q.splatX}
      } else if (kind == ${Z.splatY}) {
        ${Q.splatY}
      } else if (kind == ${Z.blurX}) {
        ${Q.blurX}
      } else {
        ${Q.blurY}
      }
    }
  }
}
`, Ot = "return cmRegion();", kt = {
	key: "equalization",
	glslType: "float",
	default: h.equalization,
	range: { ...g.equalization },
	label: M.equalization
}, At = (e, t, n) => [
	{
		key: e.mean,
		glslType: "vec2",
		length: 5,
		default: Array(10).fill(0),
		label: `${t} cluster colours`,
		computed: n
	},
	{
		key: e.sd,
		glslType: "vec2",
		length: 5,
		default: Array(10).fill(0),
		label: `${t} cluster spreads`,
		computed: n
	},
	{
		key: e.weight,
		glslType: "float",
		length: 5,
		default: [
			,
			,
			,
			,
			,
		].fill(0),
		label: `${t} cluster sizes`,
		computed: n
	}
], jt = [
	{
		key: "on",
		glslType: "bool",
		default: h.on,
		label: M.on
	},
	{
		key: "clusters",
		glslType: "int",
		default: h.clusters,
		range: { ...g.clusters },
		label: M.clusters
	},
	{
		key: "dominance",
		glslType: "float",
		default: h.dominance,
		range: { ...g.dominance },
		label: M.dominance
	},
	kt,
	{
		key: E,
		glslType: "int",
		default: 0
	},
	...At(D, "Source", !1),
	...At(O, "Target", !0)
], Mt = [{
	key: A,
	kind: "lut",
	width: m,
	height: 1,
	format: "r16f"
}, {
	key: j,
	kind: "lut",
	width: m,
	height: 1,
	format: "r16f",
	perPhoto: !0
}];
function Nt() {
	return {
		id: w,
		name: "Colour Mapping",
		phase: "display-adjust",
		priority: 85,
		reads: "current",
		space: {
			encoding: "linear",
			primaries: "rec709"
		},
		glsl: Tt,
		helpers: wt,
		uniforms: jt,
		textures: Mt,
		passes: [{
			channels: 4,
			glsl: Dt,
			helpers: Et,
			region: Ot,
			iterations: {
				key: E,
				max: pe
			},
			uniforms: [kt]
		}],
		dormantWhen: { on: !1 },
		dataKeys: [...Ee]
	};
}
//#endregion
//#region src/textures.ts
var Pt = class {
	host;
	sources = /* @__PURE__ */ new Map();
	targets = /* @__PURE__ */ new Map();
	version = 1;
	constructor(e) {
		this.host = e;
	}
	register() {
		this.host.setStageTextureProvider(w, A, (e, t, n) => this.source(e, n)), this.host.setStageTextureProvider(w, j, (e) => this.target(e));
	}
	unregister() {
		this.host.setStageTextureProvider(w, A, null), this.host.setStageTextureProvider(w, j, null);
	}
	rememberSource(e) {
		let t = b(e), n = y(e);
		return n && this.sources.set(t, n), t;
	}
	setTarget(e, t) {
		this.targets.set(e, t), this.host.dropStageTextureVariants(w, j, e);
	}
	texture(e) {
		return de(e, this.version++);
	}
	async source(e, t) {
		if (e === "analysis") return null;
		let n = this.sources.get(e);
		if (!n) {
			let r = t?.[N(k)];
			if (typeof r != "string" || b(r) !== e || (n = y(r) ?? void 0, !n)) return null;
			this.sources.set(e, n);
		}
		return this.texture(n);
	}
	async target(e) {
		if (e === "analysis") return null;
		let t = this.targets.get(e);
		if (t) return this.texture(t);
		let n = await this.host.develop.getPhotoData(De, e), r = this.targets.get(e) ?? (n ? ce(n) : null);
		return r ? (this.targets.set(e, r), this.texture(r)) : null;
	}
}, Ft = null, $ = null, It = [];
function Lt(e) {
	ze(e), He(), Ft = e, $ = new Pt(e), Ze($), e.registerProcessingStage(Nt()), $.register(), e.registerPanel({
		id: Se,
		title: T,
		component: gt,
		defaultDock: {
			module: "develop",
			direction: "right",
			width: 268
		},
		modules: ["develop"],
		onReset: _t,
		ownsBag: [`${w}.`]
	}), e.registerGridMenuItem({
		id: Ce,
		label: (e) => e.length > 1 ? `Match to colour source (${e.length})` : "Match to colour source",
		enabled: () => W().getState().source !== null && W().getState().busy === null,
		onClick: (e) => void ct(e)
	}), It = [
		e.settings.onChange((e, t) => {
			e === "source" && W().getState().setSource(Be(t));
		}),
		e.variables.subscribe(Ye, (e) => W().getState().setReference(Ve(e.value))),
		e.stores.useDevelopStore.subscribe((e, t) => {
			if (e.paramBag === t.paramBag) return;
			let n = Re(e.paramBag);
			n && e.setDynParams(n);
		})
	];
}
function Rt() {
	let e = Ft;
	if (e) {
		Ft = null;
		try {
			for (let e of It) e();
			It = [], $?.unregister(), $ = null, e.unregisterProcessingStage(w);
		} catch (e) {
			console.warn("[colour-mapping] deactivate failed:", e);
		}
	}
}
//#endregion
export { C as EXT_ID, Se as PANEL_ID, Lt as activate, Rt as deactivate };

//# sourceMappingURL=index.js.map