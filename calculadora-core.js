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
    // --- Cafe NO obligatorio (post reunion Jesus 2026-05-29) ---
    // La calculadora pivota a eficiencia energetica + CAEs (oportunidad Repsol). El cafe
    // pasa a ser dato opcional, proxy del tiempo de uso de la maquina. Si no se introduce,
    // las formulas que dependen de cafe devuelven 0 sin error y el motor sigue corriendo
    // con energia + financiero + el resto.
    const cafes = Math.max(0, Number(inputs.cafes_dia) || 0);

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
    // kB ajustado tras reunion Jesus 2026-05-29: 2g sube de 18 a 24 kWh/dia (consenso
    // sobre modelo Gaggia Vetro como referencia, encendida 24h con mantenimiento normal).
    // TODO Jesus: validar compacta/3g/multi con cifras estandar via Gemini.
    const kB = { compacta: 10, '2g': 24, '3g': 24, multi: 12 };
    const kN = { compacta: 3, '2g': 6, '3g': 8, multi: 6 };
    const fA = antiguedad >= 10 ? 1.2 : (antiguedad >= 5 ? 1.0 : (antiguedad >= 2 ? 0.7 : 0.1));
    const diff = Math.max(0, (kB[tipoMaq] || 18) * fA - (kN[tipoMaq] || 6));
    let eMaq = diff * numMaq * precioKwh * diasOp;
    if (diasCerradosTipo === 'sueltos' && diasSem < 7) {
      eMaq -= (7 - diasSem) * 52 * 2 * precioKwh * numMaq;
      eMaq = Math.max(0, eMaq);
    }
    let eAisl = (aislamiento === 'no' || aislamiento === 'nosabe') ? 1.0 * numMaq * diasOp : 0;
    // eElec ELIMINADO tras reunion Jesus 2026-05-29 (veredicto CSV fila 25: "NADA!").
    // La formula `cafes x 1,5 x 12 x 0,20` era inventada, sin justificacion en su doc.
    // El ahorro real al pasar de monofasica a trifasica es despreciable (afecta a
    // estabilidad de red y reparto de carga por linea, no a consumo). El input elec_tipo
    // se queda en el formulario como dato descriptivo (auditoria + ficha Repsol).
    let eElec = 0;
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
    // eLuz refactorizado a kWh x precio_kWh tras reunion Jesus 2026-05-29. Verificado en
    // codigo: NO existia coef 0,80 literal; la base 3,5 EUR/dia era valor bajado a mano
    // (decision historica Jore por "riesgo legal"). Recuperamos 25,2 kWh/dia base del
    // doc Jesus (50 puntos x 2150W ahorro halogena->LED x 12h = 25,8 kWh, redondeado a
    // 25,2 para encajar con los 7,05 EUR/dia a 0,28 EUR/kWh). Ahora la tarifa electrica
    // afecta linealmente al ahorro de iluminacion (era el bug que Jesus detecto en vivo).
    const kWh_luz_base = 25.2;
    const eLuz = kWh_luz_base * fL * ft * precioKwh * diasOp;
    // eClima refactorizado a kWh x precio_kWh (paralelo a eLuz). 1,50 EUR/dia / 0,28
    // EUR/kWh = 5,36 kWh/dia base, escalado por factor tamano del local. Sensible a tarifa.
    const kWh_clima_base = 5.36;
    let eClima = clima === 'ac_antiguo' ? kWh_clima_base * ft * precioKwh * diasOp : 0;
    // === eFrio granular (v3.0-gamma, sesion 2026-06-01) ===
    // Refactor estructural §2.1 del plan vivo. El motor antes calculaba
    // eFrio = (camConserv * 1.50 + camCongel * 2.50) * diasOp (EUR/dia fijo, sin
    // sensibilidad a precio_kWh, sin granularidad por tipo de equipo).
    //
    // Ahora calcula como sumatorio por unidad y categoria:
    //   consumo_kWh_anio = n * kW_promedio * h_dia * diasOp
    //   ahorro_kWh = consumo_kWh_anio * (1 - 1/factor_mant)
    //   eFrio = ahorro_kWh * precio_kWh
    //
    // El factor_mant captura el sobreconsumo por mal mantenimiento, con 3 factores
    // independientes (cifras verificadas en 2026-06-01_cifras-IDAE-equipos.md):
    //   - Condensador sucio: +15% (bia.app, rango 10-30%)
    //   - Cercania a fuente de calor: +8% (intarcon/servicios24h)
    //   - Apertura constante de puertas: +7% (nergiza.com literal)
    //   Suma maxima: +30% (techo Jesus reunion 2026-05-29)
    //
    // Cuidado matematico: si factor_mant = 1.30, el ahorro reclamable es
    // consumo * (1 - 1/1.30) = consumo * 0.231, NO consumo * 0.30. Es defendible
    // ante Repsol (Jesus pidio cifras rigorosas para entrar en Guia Repsol).
    //
    // Compatibility: si los 3 checkboxes granulares no vienen en inputs, derivamos
    // el factor desde mant_preventivo (no=1.30, si=1.00, nosabe=1.10).
    // Si NO hay inputs granulares por categoria, las camaras simples (camConserv/
    // camCongel) entran al sumatorio con defaults kW=0.50/1.00 y h=24.

    // Defaults kW promedio (no pico, considera duty cycle del compresor) y horas/dia
    // por categoria. Cliente puede sobreescribir el kW si lo conoce (medidor enchufado).
    const FRIO_DEFAULTS = {
      botellero:      { kw: 0.18, h: 24 },
      mesa_fria:      { kw: 0.30, h: 24 },
      congelador:     { kw: 0.45, h: 24 },
      nevera:         { kw: 0.25, h: 24 },
      abatidor:       { kw: 2.00, h: 2  },
      camara_conserv: { kw: 0.50, h: 24 },
      camara_congel:  { kw: 1.00, h: 24 }
    };

    // Factor de mantenimiento desde checkboxes granulares (si vienen). Si no,
    // fallback heuristico desde mant_preventivo.
    const tieneGranularMant = (
      inputs.condensador_sucio !== undefined ||
      inputs.cercania_calor   !== undefined ||
      inputs.apertura_puertas !== undefined
    );
    let factorMant;
    if (tieneGranularMant) {
      const c1 = inputs.condensador_sucio ? 0.15 : 0;
      const c2 = inputs.cercania_calor   ? 0.08 : 0;
      const c3 = inputs.apertura_puertas ? 0.07 : 0;
      factorMant = 1 + Math.min(0.30, c1 + c2 + c3);
    } else {
      factorMant = mantPrev === 'no' ? 1.30 : (mantPrev === 'si' ? 1.00 : 1.10);
    }

    // Helper: consumo anual (kWh) para una categoria n*kw*h*diasOp con defaults
    function consumoFrio(n, kw_raw, h_raw, defaults) {
      const cantidad = Math.max(0, Number(n) || 0);
      if (cantidad === 0) return 0;
      const kw = (kw_raw > 0) ? Number(kw_raw) : defaults.kw;
      const h  = (h_raw > 0)  ? Math.min(24, Number(h_raw)) : defaults.h;
      return cantidad * kw * h * diasOp;
    }

    const kwh_botelleros     = consumoFrio(inputs.botelleros_n,     inputs.botelleros_kw,     inputs.botelleros_h,     FRIO_DEFAULTS.botellero);
    const kwh_mesas_frias    = consumoFrio(inputs.mesas_frias_n,    inputs.mesas_frias_kw,    inputs.mesas_frias_h,    FRIO_DEFAULTS.mesa_fria);
    const kwh_congeladores   = consumoFrio(inputs.congeladores_n,   inputs.congeladores_kw,   inputs.congeladores_h,   FRIO_DEFAULTS.congelador);
    const kwh_neveras        = consumoFrio(inputs.neveras_n,        inputs.neveras_kw,        inputs.neveras_h,        FRIO_DEFAULTS.nevera);
    const kwh_abatidor       = consumoFrio(inputs.abatidor_n,       inputs.abatidor_kw,       inputs.abatidor_h,       FRIO_DEFAULTS.abatidor);
    const kwh_camara_conserv = consumoFrio(camConserv,              inputs.camaras_conserv_kw, inputs.camaras_conserv_h, FRIO_DEFAULTS.camara_conserv);
    const kwh_camara_congel  = consumoFrio(camCongel,               inputs.camaras_congel_kw,  inputs.camaras_congel_h,  FRIO_DEFAULTS.camara_congel);

    const kwh_frio_total = (
      kwh_botelleros + kwh_mesas_frias + kwh_congeladores + kwh_neveras +
      kwh_abatidor + kwh_camara_conserv + kwh_camara_congel
    );

    const ahorro_kwh_frio = kwh_frio_total * (1 - 1 / factorMant);
    let eFrio = ahorro_kwh_frio * precioKwh;
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
    // iIn (insourcing de jarabes/chai) ELIMINADO en v3.0-gamma.1 (2026-06-01, J1).
    // Razon: la calculadora pivoto a eficiencia energetica + CAEs (oportunidad Repsol).
    // Los jarabes son insumos estrategicos pero no defendibles ante Repsol como ahorro
    // energetico. Quitarlos baja HARD Cafe Conrado de 19406 a 17201 y La Estacion de
    // 31075 a 27225, alivia la sensacion "se dispara insumos" que detecto Jesus.
    let iE = 0;
    if (tamperAuto === 'no') iE += cafes * 0.01 * diasOp;
    if (espumadorAuto === 'no' && (tecnicaLeche === 'calienta' || tecnicaLeche === 'nosabe')) iE += cafes * pctL * 0.015 * diasOp;
    const sub = iL + iG + iA + iE;
    const pen = comprasExt === 'frecuente' ? sub * 0.10 : (comprasExt === 'aveces' ? sub * 0.05 : 0);
    const INSUMOS = sub + pen;

    // --- Operativo (hard) y estratégico (soft) ---
    const oF = 0.5 * 14 * diasOp;
    let oD = comandas === 'no' ? (cafes <= 100 ? 150 : 300) : 0;
    let sAv = mantPrev === 'no' ? (cafes <= 100 ? 1000 : (cafes <= 150 ? 2000 : 3500)) : 0;
    let sRo = 0;
    if (rotacion === 'alta') sRo = cafes <= 100 ? 1500 : (cafes <= 150 ? 2500 : 3000);
    else if (rotacion === 'media') sRo = cafes <= 100 ? 750 : (cafes <= 150 ? 1250 : 1500);
    // sVe refactorizado tras reunion Jesus 2026-05-29 (CSV fila 24): la metrica original
    // "5/8 cafes extra x 1,60 EUR margen x diasOp" se reemplaza por "1h/dia ahorrada
    // x 2,50 EUR/hora trabajada x diasOp" (Jesus dixit). Solo aplica si hay cafes (proxy
    // de actividad en barra). TODO Jore con Yemy: validar 1h/dia ahorradas y los 2,50
    // EUR/hora como margen real (vs precio venta o coste empleado).
    const horasAhorradasDia = 1.0;
    const margenPorHora = 2.50;
    const sVe = cafes > 0 ? horasAhorradasDia * margenPorHora * diasOp : 0;

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
      // Desglose insumos (iIn eliminado v3.0-gamma.1, ver J1)
      iL, iG, iA, iE, pen, sub,
      // Operativo y soft
      oF, oD, sAv, sRo, sVe,
      // Rangos
      hMin, hMax, hSeg,
      // §2.1 desglose frio granular (v3.0-gamma)
      kwh_frio_total, ahorro_kwh_frio, factorMant,
      kwh_botelleros, kwh_mesas_frias, kwh_congeladores, kwh_neveras,
      kwh_abatidor, kwh_camara_conserv, kwh_camara_congel,
      // Variables derivadas (útiles para diagnosticar tests)
      diasOp, ft, precioCafe, plazoRenting, coefRenting,
    };
  }

  // === NOMBRES_LEGIBLES (v3.0-gamma.1, 2026-06-01, J3) ===
  // Mapa interno -> humano de las variables del motor. Uso futuro: render del
  // desglose por item en el output (J9), MOTOR.md (J4), y cualquier capa de UI
  // que quiera enseñar al cliente de donde sale cada euro sin abrir el codigo.
  // Mantener sincronizado con las variables del return de calcularPuro.
  const NOMBRES_LEGIBLES = {
    // Energia
    eMaq:  'Maquina de cafe',
    eAisl: 'Aislamiento de la caldera',
    eElec: 'Instalacion electrica (mono vs tri)',
    eLuz:  'Iluminacion',
    eClima:'Climatizacion',
    eFrio: 'Refrigeracion (frio granular)',
    ePerl: 'Perlizadores de grifos',
    eAnti: 'Tratamiento del agua',
    eHielo:'Maquina de hielo',
    eLava: 'Lavavajillas / lavavasos',
    eInf:  'Infusiones (hervidor vs caldera)',
    // Insumos
    iL: 'Sobreconsumo de leche al calentar',
    iG: 'Sobre-dosificacion de cafe',
    iA: 'Azucar en barra libre',
    iE: 'Errores manuales (tamper + espumador)',
    pen:'Penalizacion compras de emergencia',
    // Operativo (HARD)
    oF: 'Mise en Place (tiempo perdido buscando)',
    oD: 'Sistema de comandas',
    // Estrategico (SOFT)
    sAv:'Averias evitables (mantenimiento preventivo)',
    sRo:'Rotacion de personal',
    sVe:'Velocidad de servicio',
    // Financiero
    fin:'Bajada del precio del cafe (modelo cesion)'
  };

  // Exponer en navegador (window) y Node (module.exports) sin tocar al otro.
  root.calcularPuro = calcularPuro;
  root.calculadoraCore = { calcularPuro, fmt, NOMBRES_LEGIBLES };
  root.NOMBRES_LEGIBLES = NOMBRES_LEGIBLES;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { calcularPuro, fmt, NOMBRES_LEGIBLES };
  }
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
