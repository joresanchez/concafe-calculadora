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
    // === eAisl unificada con chaqueta termica (decision Jesus reunion 2026-06-03) ===
    // Jesus aclaro que "aislamiento de la caldera" y "chaqueta termica de la caldera"
    // son lo mismo conceptualmente. Antes habia dos inputs (aislamiento + maquina_chaqueta)
    // y dos formulas independientes (eAisl + eApagado.chaqueta) que se sumaban; doble
    // computo del mismo concepto fisico. Ahora un unico input maquina_chaqueta dispara
    // la formula eAisl, mas conservadora y trazable al doc Jesus de 52 paginas
    // (1,0 EUR/dia x numMaq x diasOp, refactorizada a kWh para sensibilidad al precio).
    //
    // Formula vigente:
    //   3.5714 kWh/dia × numMaq × diasOp × precio_kWh = 308 EUR/anio a 0.28 EUR/kWh.
    const KWH_AISL_DIA = 1.0 / 0.28;  // 3.5714 kWh/dia
    const chaqueta = inputs.maquina_chaqueta;  // 'si' | 'no' | 'nosabe'
    let eAisl = (chaqueta === 'no' || chaqueta === 'nosabe') ? KWH_AISL_DIA * numMaq * diasOp * precioKwh : 0;
    // === eApagado nocturno (v3.0-gamma M8 §2.6; sub-componente chaqueta eliminado 2026-06-03) ===
    // Instalar temporizador (~20 EUR) ahorra el consumo nocturno cuando la maquina queda
    // encendida 24h y el local cierra >=10h/dia:
    //   eApagado = kN[tipoMaq] × horas_cerrado/24 × numMaq × diasOp × precio_kWh.
    // Solo se reclama ahorro si el cliente confirma 'no'; 'nosabe' no infla cifras.
    const apagadoNoct = inputs.maquina_apagado;   // 'si' | 'no' | 'nosabe'
    const knMaq = kN[tipoMaq] || 6;                // kWh/dia referencia maquina nueva
    const horasCerrado = Math.max(0, 24 - horasDia);
    let eApagado = 0;
    if (apagadoNoct === 'no' && horasCerrado >= 10) {
      eApagado = knMaq * (horasCerrado / 24) * numMaq * diasOp * precioKwh;
    }
    // eElec ELIMINADO tras reunion Jesus 2026-05-29 (veredicto CSV fila 25: "NADA!").
    // La formula `cafes x 1,5 x 12 x 0,20` era inventada, sin justificacion en su doc.
    // El ahorro real al pasar de monofasica a trifasica es despreciable (afecta a
    // estabilidad de red y reparto de carga por linea, no a consumo). El input elec_tipo
    // se queda en el formulario como dato descriptivo (auditoria + ficha Repsol).
    let eElec = 0;
    // D.12 (v3.0 Hito B): iluminacion multi-select.
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
    // === eLuz (v3.0-gamma M7, §2.7 Iluminacion % factura simplificada) ===
    // Dos modos en paralelo:
    //
    // 1. Modo SIMPLIFICADO (§2.7, decision Jesus 2026-05-29 + Jore 2026-06-01):
    //    si cliente da importe_factura_mensual > 0, motor usa:
    //      eLuz = importe_anual × 8% (iluminacion hosteleria, fuentes oficiales)
    //             × ahorro_pct_LED segun bombilla predominante
    //    Ahorro al cambiar a LED (caedigital + IDAE):
    //      desde halogena: 75% · desde fluorescente: 50% · desde LED: 0 · desconocido: 0
    //    Si tiene varias marcadas (iluminacion_multi), domina la peor: halogena > fluo > LED.
    //
    // 2. Modo GRANULAR (v3.0-gamma.1 base): si NO hay importe_factura, motor usa
    //    25.2 kWh/dia × fL × ft × precio_kWh × diasOp. Mantiene compatibilidad con
    //    goldens del harness (baseInputs no incluye importe_factura → cae al granular).
    const importeFacturaMensual = Math.max(0, Number(inputs.importe_factura_mensual) || 0);
    let eLuz;
    if (importeFacturaMensual > 0) {
      const PCT_ILUMINACION = 0.08;
      const AHORROS_LED = { halogena: 0.75, fluorescente: 0.50, led: 0 };
      let predominante = null;
      if (Array.isArray(inputs.iluminacion_multi)) {
        if (inputs.iluminacion_multi.indexOf('halogena') >= 0) predominante = 'halogena';
        else if (inputs.iluminacion_multi.indexOf('fluorescente') >= 0) predominante = 'fluorescente';
        else if (inputs.iluminacion_multi.indexOf('led') >= 0) predominante = 'led';
      } else {
        if (iluminacion === 'halogena' || iluminacion === 'mixta') predominante = 'halogena';
        else if (iluminacion === 'fluorescente') predominante = 'fluorescente';
        else if (iluminacion === 'led' || iluminacion === 'nosabe') predominante = 'led';
      }
      const ahorro_pct = AHORROS_LED[predominante] || 0;
      eLuz = importeFacturaMensual * 12 * PCT_ILUMINACION * ahorro_pct;
    } else {
      // Modo granular (mantiene goldens v3.0-gamma.1).
      const kWh_luz_base = 25.2;
      eLuz = kWh_luz_base * fL * ft * precioKwh * diasOp;
    }
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

    // Helper: consumo anual (kWh) para una categoria n*kw*h*diasOp con defaults.
    // Compartido entre frio (§2.1) y cocina (§2.2). Si el cliente da kW propio
    // (medidor enchufado), prevalece sobre el default conservador del sector.
    function consumoEquipo(n, kw_raw, h_raw, defaults) {
      const cantidad = Math.max(0, Number(n) || 0);
      if (cantidad === 0) return 0;
      const kw = (kw_raw > 0) ? Number(kw_raw) : defaults.kw;
      const h  = (h_raw > 0)  ? Math.min(24, Number(h_raw)) : defaults.h;
      return cantidad * kw * h * diasOp;
    }

    const kwh_botelleros     = consumoEquipo(inputs.botelleros_n,     inputs.botelleros_kw,     inputs.botelleros_h,     FRIO_DEFAULTS.botellero);
    const kwh_mesas_frias    = consumoEquipo(inputs.mesas_frias_n,    inputs.mesas_frias_kw,    inputs.mesas_frias_h,    FRIO_DEFAULTS.mesa_fria);
    const kwh_congeladores   = consumoEquipo(inputs.congeladores_n,   inputs.congeladores_kw,   inputs.congeladores_h,   FRIO_DEFAULTS.congelador);
    const kwh_neveras        = consumoEquipo(inputs.neveras_n,        inputs.neveras_kw,        inputs.neveras_h,        FRIO_DEFAULTS.nevera);
    const kwh_abatidor       = consumoEquipo(inputs.abatidor_n,       inputs.abatidor_kw,       inputs.abatidor_h,       FRIO_DEFAULTS.abatidor);
    const kwh_camara_conserv = consumoEquipo(camConserv,              inputs.camaras_conserv_kw, inputs.camaras_conserv_h, FRIO_DEFAULTS.camara_conserv);
    const kwh_camara_congel  = consumoEquipo(camCongel,               inputs.camaras_congel_kw,  inputs.camaras_congel_h,  FRIO_DEFAULTS.camara_congel);

    const kwh_frio_total = (
      kwh_botelleros + kwh_mesas_frias + kwh_congeladores + kwh_neveras +
      kwh_abatidor + kwh_camara_conserv + kwh_camara_congel
    );

    // §2.4 CAE / Decision 8 (Jore 2026-06-02): si el cliente marca sustitucion para
    // un equipo de frio (cae_<x>_old), el equipo nuevo sera limpio (sin condensador
    // sucio, sin sobreconsumo de mantenimiento). Excluimos su kWh del calculo de eFrio
    // para evitar double-counting frente a Repsol. El ahorro del equipo nuevo se
    // contabiliza por separado en el bloque CAE (futuro = ahorro_kwh × vida × 0,10 EUR).
    const kwh_frio_excluido_cae = (
      (inputs.cae_botellero_old      ? kwh_botelleros      : 0) +
      (inputs.cae_mesa_fria_old      ? kwh_mesas_frias     : 0) +
      (inputs.cae_congelador_old     ? kwh_congeladores    : 0) +
      (inputs.cae_nevera_old         ? kwh_neveras         : 0) +
      (inputs.cae_abatidor_old       ? kwh_abatidor        : 0) +
      (inputs.cae_camara_conserv_old ? kwh_camara_conserv  : 0) +
      (inputs.cae_camara_congel_old  ? kwh_camara_congel   : 0)
    );
    const kwh_frio_para_mant = Math.max(0, kwh_frio_total - kwh_frio_excluido_cae);
    const ahorro_kwh_frio = kwh_frio_para_mant * (1 - 1 / factorMant);
    let eFrio = ahorro_kwh_frio * precioKwh;

    // === §2.2 Cocina + otros equipos granular (v3.0-gamma, sesion 2026-06-01) ===
    // Decision Jore 2026-06-01 (opcion A): solo CAPTURAR consumo en kWh/anio
    // por categoria. NO se genera ahorro en HARD aqui (eCocina = 0). Razon:
    // la cocina no tiene factor de mantenimiento estandar acumulativo como
    // el frio (no hay "condensador sucio" para una freidora). El ahorro real
    // viene de los CAEs al sustituir equipos viejos (entra en §2.4).
    //
    // Defaults conservadores por categoria (validables con Jesus el miercoles).
    // Cliente puede sobreescribir kW/h si los conoce. Si no, asumimos defaults.
    const COCINA_DEFAULTS = {
      fuego_electrico: { kw: 2.0,  h: 4 },  // vitroceramica zona tipica, uso parcial 4h/dia
      freidora:        { kw: 10.0, h: 4 },  // 10L × 1 kW/L industrial, 4h/dia uso real
      salamandra:      { kw: 3.0,  h: 2 },  // 2-4 kW pico, uso esporadico
      mesa_caliente:   { kw: 1.5,  h: 8 },  // bano maria continuo 8h
      montacargas:     { kw: 1.2,  h: 2 },  // uso intermitente, 2h activo/dia
      lavavasos:       { kw: 2.5,  h: 6 },  // 2.8-3.4 kW pico × duty cycle 70%
      gas_equipo_kwh_dia: 10                // 10 kWh/dia por equipo a gas si no conoce consumo
    };
    const KWH_POR_M3_GAS = 11.7;  // 1 m^3 gas natural (PCS) - reservado para conversion futura

    // Fuegos electricos y freidoras: la UI captura solo el numero (sin kW/h).
    // Pasan por default puro (kw × h × diasOp × n).
    const kwh_fuegos = Math.max(0, Number(inputs.cocina_fuegos) || 0) *
                       COCINA_DEFAULTS.fuego_electrico.kw *
                       COCINA_DEFAULTS.fuego_electrico.h *
                       diasOp;
    const kwh_freidoras = Math.max(0, Number(inputs.cocina_freidoras_n) || 0) *
                          COCINA_DEFAULTS.freidora.kw *
                          COCINA_DEFAULTS.freidora.h *
                          diasOp;

    // Salamandra, mesas calientes, lavavasos: UI ya captura n+kW+h. Helper consumoEquipo.
    const kwh_salamandra      = consumoEquipo(inputs.salamandra_n,      inputs.salamandra_kw,      inputs.salamandra_h,      COCINA_DEFAULTS.salamandra);
    const kwh_mesas_calientes = consumoEquipo(inputs.mesas_calientes_n, inputs.mesas_calientes_kw, inputs.mesas_calientes_h, COCINA_DEFAULTS.mesa_caliente);
    const kwh_lavavasos       = consumoEquipo(inputs.lavavasos_n,       inputs.lavavasos_kw,       inputs.lavavasos_h,       COCINA_DEFAULTS.lavavasos);

    // Montacargas: M3 (J6, 2026-06-01) elimino el select si/no. Ahora se detecta
    // "tiene montacargas" si kW > 0 o horas > 0. Patron uniforme con resto de equipos.
    const tieneMontacargas = Number(inputs.montacargas_kw) > 0 || Number(inputs.montacargas_horas) > 0;
    const kwh_montacargas = tieneMontacargas
      ? consumoEquipo(1, inputs.montacargas_kw, inputs.montacargas_horas, COCINA_DEFAULTS.montacargas)
      : 0;

    // Gas (cocina): el cliente puede meter consumo directo (kWh/dia, asumido por convencion v3.0-gamma)
    // o solo el numero de equipos a gas (asumimos default 10 kWh/dia por equipo). TODO sucesor:
    // anadir select unidad m3/dia vs kWh/dia para mayor precision.
    let kwh_gas_dia = 0;
    if (Number(inputs.cocina_gas_consumo) > 0) {
      kwh_gas_dia = Number(inputs.cocina_gas_consumo);
    } else if (Number(inputs.cocina_gas_equipos) > 0) {
      kwh_gas_dia = Number(inputs.cocina_gas_equipos) * COCINA_DEFAULTS.gas_equipo_kwh_dia;
    }
    const kwh_gas = kwh_gas_dia * diasOp;

    const kwh_cocina_total = (
      kwh_fuegos + kwh_freidoras + kwh_salamandra +
      kwh_mesas_calientes + kwh_montacargas + kwh_lavavasos + kwh_gas
    );

    // eCocina = 0 hasta §2.4 CAEs (decision Jore opcion A, 2026-06-01).
    // El consumo capturado (kwh_cocina_total + desglose) se expone en el return
    // para que el bloque CAEs lo consuma al calcular ahorros por sustitucion.
    const eCocina = 0;
    let ePerl = perlizadores === 'no' ? 1.20 * ft * diasOp : 0;
    let eAnti = tratAgua === 'no' ? 0.50 * diasOp : 0;
    // === eHielo refactor (§2.8, v3.0-gamma 2026-06-01, M2) ===
    // Antes: 0,80 EUR/dia fijo si maq_hielo='antigua' (sin precio_kWh, sin aforo).
    // Ahora: si aforo > 0, calculo real basado en demanda de hielo del local.
    //   demanda_kg_anio = aforo × kg_persona_dia × diasOp
    //   ahorro_kWh = demanda × (kWh_antigua - kWh_eficiente)
    //   eHielo = ahorro_kWh × precio_kWh
    // Cifras IDAE/sector (validar Jesus miercoles 03/06):
    //   - 0.1 kg/persona/dia conservador (bar coctel >> 0.5). Validar.
    //   - Antigua: 0.5 kWh/kg hielo producido
    //   - Eficiente: 0.18 kWh/kg (felac.com, modelo bajo consumo)
    //   - Delta ahorro: 0.32 kWh/kg
    //
    // === Refactor 2026-06-03 (reunion Jesus) ===
    // El select maq_hielo ('antigua'/'nueva'/'no'/'nosabe') + modo aforo desaparece.
    // Ahora dos bloques separados (refrigerada por aire + por agua) con patron
    // uniforme n+kW+h como el resto de equipos. eHielo = 0 en HARD: el ahorro se
    // materializa en el bloque §2.4 CAEs por sustitucion (la antiguedad la declara
    // el auditor via los checkboxes CAE >5a o renovado<3a por tipo).
    //
    // Pendiente Jesus: ahorro adicional al pasar de aire->agua (eficiencia electrica
    // +30% aprox + 1,68 L agua/kg hielo). No entra al motor todavia.
    const HIELO_DEFAULTS = {
      aire: { kw: 0.40, h: 24 },  // maquina convencional refrigerada por aire (sector)
      agua: { kw: 0.28, h: 24 }   // -30% electricidad vs aire, gasta agua de red
    };
    const kwh_hielo_aire = consumoEquipo(
      inputs.hielo_aire_n, inputs.hielo_aire_kw, inputs.hielo_aire_h,
      HIELO_DEFAULTS.aire
    );
    const kwh_hielo_agua = consumoEquipo(
      inputs.hielo_agua_n, inputs.hielo_agua_kw, inputs.hielo_agua_h,
      HIELO_DEFAULTS.agua
    );
    let eHielo = 0;
    // === eLava + eInf refactor a kWh × precio_kWh (v3.0-gamma M9, 2026-06-01) ===
    // Antes: cupula 1.0 EUR/dia, sin maquina 0.5 EUR/dia, infusion 0.04 EUR/inf.
    // Ahora: convertidos a kWh equivalentes a 0.28 EUR/kWh referencia. Identico a
    // 0.28 (preserva goldens) + sensible al precio (Jesus).
    const KWH_LAVA_CUPULA_DIA = 1.0 / 0.28;  // 3.5714 kWh/dia
    const KWH_LAVA_SIN_DIA    = 0.5 / 0.28;  // 1.7857 kWh/dia
    const KWH_INF_POR_INF     = 0.04 / 0.28; // 0.1429 kWh/infusion
    let eLava;
    if (lavaplatos === 'cupula')   eLava = KWH_LAVA_CUPULA_DIA * diasOp * precioKwh;
    else if (lavaplatos === 'no')  eLava = KWH_LAVA_SIN_DIA    * diasOp * precioKwh;
    else                            eLava = 0;
    let eInf = infusiones * KWH_INF_POR_INF * diasOp * precioKwh;
    const ENERGIA = eMaq + eAisl + eApagado + eElec + eLuz + eClima + eFrio + ePerl + eAnti + eHielo + eLava + eInf;

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
    // de actividad en barra).
    //
    // VALIDADO 2026-06-02 contra fuentes oficiales (ver 2026-06-02_validacion-sVe.md):
    //   - Convenio hosteleria Espana 2025-26 (camarero Nivel III) -> coste empresa ~14 EUR/h.
    //   - Margen contributivo cafeteria (Espressa/Qamarero/Mapal) -> 12-18 EUR/h si la
    //     hora liberada se reutiliza en venta directa.
    //   - Formula vieja doc Jesus (5 cafes x 1,60 EUR) -> 8 EUR/h.
    // El 2,50 EUR/h actual es ULTRA-conservador a proposito (defensibilidad Repsol) y
    // representa MARGEN MINIMO defendible (NO coste evitado del camarero fijo, NO margen
    // contributivo bruto). Rango defendible: 2,50-15 EUR/h segun interpretacion.
    // Pendiente reunion Jesus 03/06: confirmar interpretacion + posible input editable
    // en UI (margen_hora_personal con default 2,50).
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

    // ========================================================================
    // === §2.4 CAEs (v3.0-gamma final, 2026-06-02) ===========================
    // ========================================================================
    // Bloque de Creditos de Ahorro al Consumo. 19 equipos × 2 vias por equipo:
    //   cae_<x>_old:    > 5 anios, propuesta de sustitucion. Genera CAE futuro
    //                   + inversion (catalogo orientativo, override del cliente).
    //   cae_<x>_renew:  renovado < 3 anios con factura. Genera CAE retroactivo,
    //                   sin inversion (ya esta comprado).
    // Si ambos marcados a la vez, prioriza old (CAE futuro = sustitucion).
    // Si nadie marca nada, todo a 0 y la UI no renderiza el bloque (decision 3).
    //
    // Decisiones cerradas con Jore 2026-06-02 (las 8 de arquitectura-CAEs §8):
    //   1. CAE retroactivo descuenta vida util ya transcurrida (1.5 anios asumidos).
    //   2. Si cae_<frio>_old marcado, descontar kWh del calculo de eFrio (arriba).
    //   3. Bloque CAE no se renderiza si nadie marca nada (gestion UI).
    //   4. coef_renting unico 2,1%/mes editable (input existente).
    //   5. Catalogo precios orientativos publicos + override por cliente.
    //   6. Sin selector fecha factura: asumimos CAE_RETRO_YEARS = 1.5.
    //   7. Gas via PCS 11.7 kWh/m3 (ya esta en el motor).
    //   8. Equipo nuevo de frio tiene factor_mant = 1.00 (via exclusion en eFrio).

    const CAE_EUR_KWH = 0.10;     // conservador dentro del rango oficial (caedigital 2026)
    const CAE_RETRO_YEARS = 1.5;  // anios transcurridos asumidos en retroactivo

    // Consumo anual del equipo ACTUAL (kWh/anio) por categoria. Para frio, cocina
    // y hielo granular reutilizamos los kwh_X ya calculados arriba. Para maq_cafe,
    // iluminacion, climatizacion y lavavajillas, derivamos ad-hoc a partir de los
    // mismos parametros que ya alimentan ENERGIA (sin recalcular el motor).
    // kwh_hielo_aire y kwh_hielo_agua ya estan disponibles desde el refactor 2026-06-03.
    const kwh_maq_cafe_consumo = (kB[tipoMaq] || 18) * fA * numMaq * diasOp;
    let kwh_iluminacion_consumo;
    if (importeFacturaMensual > 0) {
      // Convertir el 8% factura a kWh/anio dividiendo por precio_kWh
      kwh_iluminacion_consumo = (importeFacturaMensual * 12 * 0.08) / precioKwh;
    } else {
      // Modo granular: la base 25.2 kWh/dia × fL × ft × diasOp
      kwh_iluminacion_consumo = 25.2 * fL * ft * diasOp;
    }
    const kwh_clima_consumo = (clima === 'ac_antiguo') ? 5.36 * ft * diasOp : 0;
    let kwh_lavavajillas_consumo;
    if (lavaplatos === 'cupula')     kwh_lavavajillas_consumo = (1.0 / 0.28) * diasOp;
    else if (lavaplatos === 'no')    kwh_lavavajillas_consumo = (0.5 / 0.28) * diasOp;
    else                             kwh_lavavajillas_consumo = 0;

    // % de ahorro al sustituir por equipo nuevo eficiente, por categoria. Cifras
    // conservadoras a validar con Jesus el miercoles 03/06.
    //   30% frio comercial (clase D vs A+, fuente Mundo Hosteleria + Coreco)
    //   25% cocina electrica (inducir vs vitroceramica)
    //   25% maquina cafe (chaqueta + temporizador + modelo eficiente)
    //   64% hielo (0,5 → 0,18 kWh/kg, mismas cifras §2.8)
    //   40% climatizacion (caedigital, restaurante 200 m²)
    //   20% lavado (estimacion sector, validar)
    //   Iluminacion: dinamico segun bombilla predominante (75/50/0).
    const CAE_CFG = {
      botellero:        { kwh: kwh_botelleros,           vida: 10, pct: 0.30, precio: 800 },
      mesa_fria:        { kwh: kwh_mesas_frias,          vida: 10, pct: 0.30, precio: 1200 },
      congelador:       { kwh: kwh_congeladores,         vida: 10, pct: 0.30, precio: 800 },
      nevera:           { kwh: kwh_neveras,              vida: 10, pct: 0.30, precio: 800 },
      abatidor:         { kwh: kwh_abatidor,             vida: 10, pct: 0.30, precio: 3500 },
      camara_conserv:   { kwh: kwh_camara_conserv,       vida: 12, pct: 0.30, precio: 4500 },
      camara_congel:    { kwh: kwh_camara_congel,        vida: 12, pct: 0.30, precio: 6000 },
      fuegos:           { kwh: kwh_fuegos,               vida: 12, pct: 0.25, precio: 1500 },
      freidora:         { kwh: kwh_freidoras,            vida: 12, pct: 0.25, precio: 1200 },
      salamandra:       { kwh: kwh_salamandra,           vida: 12, pct: 0.25, precio: 1000 },
      mesas_calientes:  { kwh: kwh_mesas_calientes,      vida: 12, pct: 0.25, precio: 900 },
      lavavasos:        { kwh: kwh_lavavasos,            vida: 8,  pct: 0.20, precio: 550 },
      montacargas:      { kwh: kwh_montacargas,          vida: 12, pct: 0.25, precio: 5000 },
      gas:              { kwh: kwh_gas,                  vida: 12, pct: 0.25, precio: 2000 },
      hielo_aire:       { kwh: kwh_hielo_aire,           vida: 8,  pct: 0.64, precio: 3500 },
      hielo_agua:       { kwh: kwh_hielo_agua,           vida: 8,  pct: 0.64, precio: 3500 },
      maq_cafe:         { kwh: kwh_maq_cafe_consumo,     vida: 8,  pct: 0.25, precio: 5500 },
      iluminacion:      { kwh: kwh_iluminacion_consumo,  vida: 15, pct: null, precio: 2000 },
      climatizacion:    { kwh: kwh_clima_consumo,        vida: 15, pct: 0.40, precio: 16000 },
      lavavajillas:     { kwh: kwh_lavavajillas_consumo, vida: 8,  pct: 0.20, precio: 720 }
    };

    // pct de iluminacion dinamico segun bombilla predominante (la peor entre marcadas).
    let pct_iluminacion_dinamico = 0;
    if (Array.isArray(inputs.iluminacion_multi)) {
      if (inputs.iluminacion_multi.indexOf('halogena') >= 0) pct_iluminacion_dinamico = 0.75;
      else if (inputs.iluminacion_multi.indexOf('fluorescente') >= 0) pct_iluminacion_dinamico = 0.50;
    } else if (iluminacion === 'halogena' || iluminacion === 'mixta') {
      pct_iluminacion_dinamico = 0.75;
    } else if (iluminacion === 'fluorescente') {
      pct_iluminacion_dinamico = 0.50;
    }

    // Recorrer los 19 equipos y calcular CAE futuro/retroactivo por cada uno.
    const cae_equipos = {};
    let CAE_total_5y = 0;
    let CAE_futuro_total = 0;
    let CAE_retroactivo_total = 0;
    let inversion_total = 0;
    let hay_cae_marcado = false;

    const CAE_EQUIPOS_KEYS = Object.keys(CAE_CFG);
    for (let i = 0; i < CAE_EQUIPOS_KEYS.length; i++) {
      const eq = CAE_EQUIPOS_KEYS[i];
      const cfg = CAE_CFG[eq];
      const old = !!inputs['cae_' + eq + '_old'];
      const renew = !!inputs['cae_' + eq + '_renew'];
      if (!old && !renew) {
        cae_equipos[eq] = {
          tipo: null, ahorro_kwh: 0, anios: 0, importe: 0, inversion: 0,
          vida: cfg.vida, pct: 0, consumo_actual_kwh: cfg.kwh
        };
        continue;
      }
      hay_cae_marcado = true;
      // Si ambos marcados, prioriza old (CAE futuro). Defendible: no se reclama dos
      // veces sobre el mismo equipo.
      const tipo = old ? 'futuro' : 'retroactivo';
      const pct = (eq === 'iluminacion') ? pct_iluminacion_dinamico : cfg.pct;
      const ahorro_kwh = cfg.kwh * pct;
      const anios = (tipo === 'futuro') ? cfg.vida : Math.max(0, cfg.vida - CAE_RETRO_YEARS);
      const importe = ahorro_kwh * anios * CAE_EUR_KWH;
      // Inversion: solo si es sustitucion futura. Override del cliente si > 0.
      let inversion = 0;
      if (tipo === 'futuro') {
        const override = Number(inputs['cae_' + eq + '_inversion']) || 0;
        inversion = override > 0 ? override : cfg.precio;
      }
      cae_equipos[eq] = {
        tipo: tipo, ahorro_kwh: ahorro_kwh, anios: anios,
        importe: importe, inversion: inversion,
        vida: cfg.vida, pct: pct, consumo_actual_kwh: cfg.kwh
      };
      CAE_total_5y += importe;
      if (tipo === 'futuro') CAE_futuro_total += importe;
      else CAE_retroactivo_total += importe;
      inversion_total += inversion;
    }

    // Renting + saldos. coefRenting ya esta normalizado a fraccion (/100) en linea 78.
    // ahorro_factura_mes usa el HARD ya ajustado (eFrio descontado en linea ~290).
    const cuota_renting_mes = inversion_total * coefRenting;
    const ahorro_factura_mes = HARD / 12;
    const cae_prorrateado_mes = CAE_total_5y / 60;
    const saldo_neto_mes = ahorro_factura_mes + cae_prorrateado_mes - cuota_renting_mes;
    const saldo_neto_5y = saldo_neto_mes * 60;

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
      eMaq, eAisl, eApagado, eElec, eLuz, eClima, eFrio, ePerl, eAnti, eHielo, eLava, eInf,
      // Desglose insumos (iIn eliminado v3.0-gamma.1, ver J1)
      iL, iG, iA, iE, pen, sub,
      // Operativo y soft
      oF, oD, sAv, sRo, sVe,
      // Rangos
      hMin, hMax, hSeg,
      // §2.1 desglose frio granular (v3.0-gamma)
      kwh_frio_total, kwh_frio_excluido_cae, kwh_frio_para_mant, ahorro_kwh_frio, factorMant,
      kwh_botelleros, kwh_mesas_frias, kwh_congeladores, kwh_neveras,
      kwh_abatidor, kwh_camara_conserv, kwh_camara_congel,
      // §2.2 desglose cocina granular (v3.0-gamma): consumo solo, ahorro=0 hasta §2.4 CAEs
      kwh_cocina_total, eCocina,
      kwh_fuegos, kwh_freidoras, kwh_salamandra,
      kwh_mesas_calientes, kwh_montacargas, kwh_lavavasos, kwh_gas,
      // §2.4 CAEs (v3.0-gamma final, 2026-06-02)
      hay_cae_marcado,
      CAE_total_5y, CAE_futuro_total, CAE_retroactivo_total,
      inversion_total, cuota_renting_mes, ahorro_factura_mes,
      cae_prorrateado_mes, saldo_neto_mes, saldo_neto_5y,
      cae_equipos,
      kwh_hielo_aire, kwh_hielo_agua, kwh_maq_cafe_consumo, kwh_iluminacion_consumo,
      kwh_clima_consumo, kwh_lavavajillas_consumo,
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
    eMaq:    'Maquina de cafe',
    eAisl:   'Aislamiento de la caldera',
    eApagado:'Apagado nocturno + chaqueta termica',
    eElec:   'Instalacion electrica (mono vs tri)',
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

  // === CAE_NOMBRES (v3.0-gamma final, 2026-06-02, §2.4) ===
  // Mapa interno -> humano de los 19 equipos del bloque CAE. Lo usa el render de
  // UI para etiquetar las filas del cuadro "Repsol via CAE" sin hardcodear strings
  // en el HTML. Mantener sincronizado con CAE_CFG en calcularPuro.
  const CAE_NOMBRES = {
    botellero:       'Botellero',
    mesa_fria:       'Mesa fria',
    congelador:      'Congelador',
    nevera:          'Nevera',
    abatidor:        'Abatidor',
    camara_conserv:  'Camara de conservacion',
    camara_congel:   'Camara de congelacion',
    fuegos:          'Fuegos electricos',
    freidora:        'Freidora',
    salamandra:      'Salamandra',
    mesas_calientes: 'Mesas calientes',
    lavavasos:       'Lavavasos',
    montacargas:     'Montacargas',
    gas:             'Equipos a gas',
    hielo_aire:      'Maquina de hielo (aire)',
    hielo_agua:      'Maquina de hielo (agua)',
    maq_cafe:        'Maquina de cafe',
    iluminacion:     'Iluminacion',
    climatizacion:   'Climatizacion',
    lavavajillas:    'Lavavajillas'
  };

  // Exponer en navegador (window) y Node (module.exports) sin tocar al otro.
  root.calcularPuro = calcularPuro;
  root.calculadoraCore = { calcularPuro, fmt, NOMBRES_LEGIBLES, CAE_NOMBRES };
  root.NOMBRES_LEGIBLES = NOMBRES_LEGIBLES;
  root.CAE_NOMBRES = CAE_NOMBRES;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { calcularPuro, fmt, NOMBRES_LEGIBLES, CAE_NOMBRES };
  }
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
