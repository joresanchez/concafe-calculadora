/* calculadora-core.js
 * Motor puro de la Calculadora-Semáforo conCAFÉ v2.5.
 *
 * `calcularPuro(inputs)` recibe un objeto con los inputs ya parseados (números
 * para campos numéricos, strings para selects) y devuelve un objeto con todos
 * los valores intermedios + el resultado del semáforo. NO toca el DOM.
 *
 * Refactor del 2026-05-20 (v3.0 Paso 1): extraído desde el `calcular()` inline
 * del index.html v2.5 (commit 7651c7d). La lógica matemática es bit-a-bit la
 * misma; solo se ha separado la lectura DOM (que sigue en index.html) del
 * cálculo (que vive aquí). Esto permite que tests.html valide el mismo motor.
 *
 * Para mantener la integridad histórica del motor:
 * - Cualquier cambio numérico aquí debe ir acompañado de actualización de
 *   tests.html (no toca solo los inputs, toca también los expected).
 * - El motor sigue calibrado -6% vs documento Jesús (v2.5 baseline).
 */
(function (root) {
  'use strict';

  function fmt(n) {
    return Math.round(n).toLocaleString('es-ES') + ' €';
  }

  function calcularPuro(inputs) {
    // --- Validación de entrada (idéntica al index.html v2.5) ---
    const cafes = inputs.cafes_dia;
    if (!cafes || cafes < 1 || isNaN(cafes)) {
      return { ok: false, error: 'Introduce al menos 1 café al día.' };
    }

    // --- Normalización de inputs con sus defaults / clamps originales ---
    const infusiones = Math.max(0, inputs.infusiones_dia || 0);
    const diasSem = inputs.dias_semana;
    const diasCerradosTipo = inputs.dias_cerrados_tipo;
    const horasDia = Math.max(1, inputs.horas_dia);
    const diasOp = Math.round(diasSem * 51.4);
    const modeloAdq = inputs.modelo_adq;

    let precioCafe = Math.max(0, inputs.precio_cafe || 0);
    if (!precioCafe && modeloAdq === 'cesion') precioCafe = 28;
    if (!precioCafe && modeloAdq !== 'cesion') precioCafe = 21;

    const tipoMaq = inputs.tipo_maquina;
    const numMaq = Math.max(1, inputs.num_maquinas);
    const antiguedad = inputs.antiguedad_maq;
    const aislamiento = inputs.aislamiento;
    const tecnicaLeche = inputs.tecnica_leche;
    const dosificacion = inputs.dosificacion;
    const azucar = inputs.azucar;
    const insourcing = inputs.insourcing;
    const comprasExt = inputs.compras_ext;
    const tamperAuto = inputs.tamper_auto;
    const espumadorAuto = inputs.espumador_auto;
    const elecTipo = inputs.elec_tipo;
    const elecAntig = inputs.elec_antiguedad;

    const rawKwh = inputs.precio_kwh;
    const precioKwh = rawKwh > 0 ? rawKwh : 0.28;

    const iluminacion = inputs.iluminacion;
    const clima = inputs.climatizacion;
    const camConserv = Math.max(0, inputs.camaras_conserv);
    const camCongel = Math.max(0, inputs.camaras_congel);
    const lavaplatos = inputs.lavaplatos;
    const maqHielo = inputs.maq_hielo;
    const perlizadores = inputs.perlizadores;
    const tratAgua = inputs.tratamiento_agua;
    const manualOps = inputs.manual_ops;
    const comandas = inputs.comandas;
    const mantPrev = inputs.mant_preventivo;
    const rotacion = inputs.rotacion;

    const honorarios = Math.max(0, inputs.honorarios);
    const costeMaq = Math.max(0, inputs.coste_maquina);
    const plazoRenting = Math.max(1, inputs.plazo_renting || 60);
    const rawCoef = inputs.coef_renting;
    const coefRenting = (rawCoef >= 0 ? rawCoef : 2.1) / 100;

    // --- Factor de tamaño (volumen del local) ---
    const ft = cafes <= 100 ? 1.0 : (cafes <= 150 ? 1.2 : (cafes <= 220 ? 1.5 : 2.0));

    // --- Financiero (solo cesión: ahorro por bajar precio del café) ---
    let fin = 0;
    if (modeloAdq === 'cesion') {
      const k = (cafes * diasOp) / 120;
      fin = k * Math.max(0, precioCafe - 21);
    }

    // --- Energía ---
    const kB = { compacta: 10, '2g': 18, '3g': 24, multi: 12 };
    const kN = { compacta: 3, '2g': 6, '3g': 8, multi: 6 };
    const fA = antiguedad >= 10 ? 1.2 : (antiguedad >= 5 ? 1.0 : (antiguedad >= 2 ? 0.7 : 0.1));
    const diff = Math.max(0, (kB[tipoMaq] || 18) * fA - (kN[tipoMaq] || 6));
    let eMaq = diff * numMaq * precioKwh * diasOp;
    if (diasCerradosTipo === 'sueltos' && diasSem < 7) {
      eMaq -= (7 - diasSem) * 52 * 2 * precioKwh * numMaq;
      eMaq = Math.max(0, eMaq);
    }
    let eAisl = (aislamiento === 'no' || aislamiento === 'nosabe') ? 1.0 * numMaq * diasOp : 0;
    let eElec = (elecTipo === 'mono' || elecTipo === 'nosabe') ? cafes * 1.5 * 12 * 0.20 : 0;
    // D.12 (v3.0 Hito B) — iluminacion multi-select.
    // Acepta array `inputs.iluminacion_multi` (formato nuevo: ['led','halogena',...]).
    // Si no llega array, ruta legacy v2.5 inalterada (string en `iluminacion`).
    // Combinacion multi: PROMEDIO ARITMETICO de los fL marcados (decision Jore
    // 2026-05-20). 'nosabe' o array vacio => fL=0 (equivalente a LED, regla v2.5).
    // Compat checks:
    //   v2.5 'halogena' = 1.3        ===  v3.0 ['halogena'] = 1.3
    //   v2.5 'fluorescente' = 1.0    ===  v3.0 ['fluorescente'] = 1.0
    //   v2.5 'led' = 0               ===  v3.0 ['led'] = 0
    //   v2.5 'nosabe' = 0            ===  v3.0 ['nosabe'] = 0 / [] = 0
    //   v2.5 'mixta' = 0.6           ~=   v3.0 ['led','halogena'] = 0.65 (drift -5 EUR/anio)
    let fL = 0;
    if (Array.isArray(inputs.iluminacion_multi)) {
      const fLMap = { led: 0, fluorescente: 1.0, halogena: 1.3 };
      const sel = inputs.iluminacion_multi.filter(function (t) { return t in fLMap; });
      if (sel.length > 0) {
        fL = sel.reduce(function (acc, t) { return acc + fLMap[t]; }, 0) / sel.length;
      }
    } else if (iluminacion !== 'led' && iluminacion !== 'nosabe') {
      fL = iluminacion === 'halogena' ? 1.3 : (iluminacion === 'mixta' ? 0.6 : 1.0);
    }
    const eLuz = 3.5 * ft * fL * diasOp;
    let eClima = clima === 'ac_antiguo' ? 1.50 * ft * diasOp : 0;
    let eFrio = mantPrev === 'no' ? (camConserv * 1.50 + camCongel * 2.50) * diasOp * 0.30 : 0;
    let ePerl = perlizadores === 'no' ? 1.20 * ft * diasOp : 0;
    let eAnti = tratAgua === 'no' ? 0.50 * diasOp : 0;
    let eHielo = maqHielo === 'antigua' ? 0.80 * diasOp : 0;
    let eLava = lavaplatos === 'cupula' ? 1.0 * diasOp : (lavaplatos === 'no' ? 0.5 * diasOp : 0);
    let eInf = infusiones * 0.04 * diasOp;
    const ENERGIA = eMaq + eAisl + eElec + eLuz + eClima + eFrio + ePerl + eAnti + eHielo + eLava + eInf;

    // --- Insumos ---
    const pctL = 0.70;
    let iL = (tecnicaLeche === 'calienta' || tecnicaLeche === 'nosabe') ? cafes * pctL * 0.06 * 0.95 * diasOp : 0;
    let iG = dosificacion === 'ojo' ? cafes * 0.0015 * 25 * diasOp : 0;
    let iA = azucar === 'libre' ? cafes * 0.02 * diasOp : 0;
    let iIn = 0;
    if (insourcing === 'compra') iIn = cafes <= 100 ? 1200 : (cafes <= 150 ? 2100 : 3500);
    else if (insourcing === 'mixto') iIn = (cafes <= 100 ? 1200 : (cafes <= 150 ? 2100 : 3500)) * 0.5;
    let iE = 0;
    if (tamperAuto === 'no') iE += cafes * 0.01 * diasOp;
    if (espumadorAuto === 'no' && (tecnicaLeche === 'calienta' || tecnicaLeche === 'nosabe')) iE += cafes * pctL * 0.015 * diasOp;
    const sub = iL + iG + iA + iIn + iE;
    const pen = comprasExt === 'frecuente' ? sub * 0.10 : (comprasExt === 'aveces' ? sub * 0.05 : 0);
    const INSUMOS = sub + pen;

    // --- Operativo (hard) y estratégico (soft) ---
    const oF = 0.5 * 14 * diasOp;
    let oD = comandas === 'no' ? (cafes <= 100 ? 150 : 300) : 0;
    let sAv = mantPrev === 'no' ? (cafes <= 100 ? 1000 : (cafes <= 150 ? 2000 : 3500)) : 0;
    let sRo = 0;
    if (rotacion === 'alta') sRo = cafes <= 100 ? 1500 : (cafes <= 150 ? 2500 : 3000);
    else if (rotacion === 'media') sRo = cafes <= 100 ? 750 : (cafes <= 150 ? 1250 : 1500);
    const sVe = (cafes <= 150 ? 5 : 8) * 1.60 * diasOp;

    // --- Agregados ---
    const HARD = fin + ENERGIA + INSUMOS + oF + oD;
    const SOFT = sAv + sRo + sVe;
    const hM = HARD / 12;
    const sM = SOFT / 12;
    const cuota = (costeMaq + honorarios) * coefRenting;
    const nH = hM - cuota;
    const nT = hM + sM - cuota;
    const hMin = Math.round(hM * 0.80);
    const hMax = Math.round(hM * 1.10);
    const hSeg = HARD * 0.90;

    // --- Semáforo (idéntico a v2.5; doble condición ratio + cash flow) ---
    let color, label, sub2, mc, msg, ratio;
    if (honorarios === 0) {
      ratio = null;
      if (nH >= 0) {
        color = 'sem-verde'; label = 'VIABLE (SIN GARANTÍA)';
        sub2 = 'Sin honorarios. No hay riesgo de devolución.';
        mc = 'msg-verde';
        msg = 'No se cobran honorarios. Flujo de caja positivo.';
      } else {
        color = 'sem-amarillo'; label = 'CASH FLOW NEGATIVO';
        sub2 = 'La cuota del servicio supera el ahorro estimado.';
        mc = 'msg-amarillo';
        msg = `Sin honorarios, pero la cuota (${fmt(Math.round(cuota))}/mes) supera el ahorro (${fmt(Math.round(hM))}/mes). Reduce el precio de la máquina o alarga los plazos.`;
      }
    } else {
      const r = hSeg / honorarios;
      ratio = r;
      const cf = nH > 0;
      if (r >= 1.5 && cf) {
        color = 'sem-verde'; label = 'GARANTÍA RECOMENDADA';
        sub2 = `Ratio: ${r.toFixed(1)}x · Cash flow: +${fmt(Math.round(nH))}/mes`;
        mc = 'msg-verde';
        msg = 'Firma la garantía. Los ahorros directos cubren sobradamente nuestros honorarios y el flujo de caja es positivo.';
      } else if (r >= 1.0 && cf) {
        color = 'sem-amarillo'; label = 'GARANTÍA CON CONDICIONES';
        sub2 = `Ratio: ${r.toFixed(1)}x · Cash flow: +${fmt(Math.round(nH))}/mes`;
        mc = 'msg-amarillo';
        msg = `Garantía posible con cumplimiento estricto de la cláusula 8. Baja los honorarios a ${fmt(Math.round(hSeg / 1.5))} para que el resultado sea verde.`;
      } else if (r >= 1.0 && !cf) {
        color = 'sem-amarillo'; label = 'BUENOS RATIOS CON CASH FLOW NEGATIVO';
        sub2 = `Ratio: ${r.toFixed(1)}x · Cash flow: ${fmt(Math.round(nH))}/mes`;
        mc = 'msg-amarillo';
        msg = `El ratio cubre la garantía, pero el cliente pierde ${fmt(Math.abs(Math.round(nH)))}/mes. Reduce la máquina o alarga los plazos.`;
      } else if (!cf) {
        color = 'sem-rojo'; label = 'SIN GARANTÍA';
        sub2 = `Ratio: ${r.toFixed(1)}x · Cash flow: ${fmt(Math.round(nH))}/mes`;
        mc = 'msg-rojo';
        msg = `No podemos ofrecer la garantía. Bajamos los honorarios a ${fmt(Math.round(hSeg / 1.5))} y reducimos la máquina.`;
      } else {
        color = 'sem-rojo'; label = 'SIN GARANTÍA';
        sub2 = `Ratio: ${r.toFixed(1)}x · Cash flow: +${fmt(Math.round(nH))}/mes`;
        mc = 'msg-rojo';
        msg = `Los ahorros directos (${fmt(Math.round(HARD))}/año) no cubren los honorarios. Vendemos sin garantía o bajamos precios a ${fmt(Math.round(hSeg / 1.5))}.`;
      }
    }

    return {
      ok: true,
      // Resultado primario (semáforo)
      color, label, sub2, mc, msg, ratio,
      // Resultados financieros mensuales
      hM, sM, nH, nT, cuota,
      // Agregados anuales
      HARD, SOFT, ENERGIA, INSUMOS,
      fin,
      // Desglose energía
      eMaq, eAisl, eElec, eLuz, eClima, eFrio, ePerl, eAnti, eHielo, eLava, eInf,
      // Desglose insumos
      iL, iG, iA, iIn, iE, pen, sub,
      // Operativo y soft
      oF, oD, sAv, sRo, sVe,
      // Rangos
      hMin, hMax, hSeg,
      // Variables derivadas (útiles para diagnosticar tests)
      diasOp, ft, precioCafe, plazoRenting, coefRenting,
    };
  }

  // Exponer en navegador (window) y Node (module.exports) sin tocar al otro.
  root.calcularPuro = calcularPuro;
  root.calculadoraCore = { calcularPuro, fmt };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { calcularPuro, fmt };
  }
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
