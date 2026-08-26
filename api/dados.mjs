import {
  json,
  readJson,
  monthsBetween
} from '../lib/blob-store.mjs';

const HC_PATH = 'misscan/hc.json';
const META_PATH = 'misscan/history-meta.json';

function misscanDateValue(row = {}) {
  // Regra V6.16: para reproduzir a aba LM / ranking oficial,
  // a data operacional do recorte é LM Received.
  // SOC Packed fica somente como fallback para registros antigos.
  return String(row?.lmreceived_date || row?.socpacked_date || '').trim();
}

function misscanDateKey(row = {}) {
  return misscanDateValue(row).slice(0, 10);
}

function monthOffset(monthKey, delta) {
  const m = String(monthKey || '').match(/^(\d{4})-(\d{2})$/);
  if (!m) return monthKey;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

function isoDateUTC(date) {
  return date.toISOString().slice(0, 10);
}

function addDays(dateKey, days) {
  const d = new Date(`${dateKey}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return isoDateUTC(d);
}

function mondayOf(dateKey) {
  const d = new Date(`${dateKey}T12:00:00Z`);
  const day = d.getUTCDay();
  const delta = day === 0 ? -6 : 1 - day;
  d.setUTCDate(d.getUTCDate() + delta);
  return isoDateUTC(d);
}

function resolvePeriod(url, meta) {
  const preset = String(url.searchParams.get('preset') || '').toUpperCase();
  const customFrom = String(url.searchParams.get('from') || '');
  const customTo = String(url.searchParams.get('to') || '');

  const today = isoDateUTC(new Date());
  const availableStart = meta?.historyStart || today;
  const availableEnd = meta?.historyEnd || today;

  if (
    /^\d{4}-\d{2}-\d{2}$/.test(customFrom) &&
    /^\d{4}-\d{2}-\d{2}$/.test(customTo)
  ) {
    return {
      preset: 'CUSTOM',
      from: customFrom <= customTo ? customFrom : customTo,
      to: customFrom <= customTo ? customTo : customFrom
    };
  }

  switch (preset) {
    case 'TODAY':
      return { preset, from: today, to: today };

    case 'YESTERDAY': {
      const y = addDays(today, -1);
      return { preset, from: y, to: y };
    }

    case 'CURRENT_WEEK':
      return { preset, from: mondayOf(today), to: today };

    case 'PREVIOUS_WEEK': {
      const currentMonday = mondayOf(today);
      return {
        preset,
        from: addDays(currentMonday, -7),
        to: addDays(currentMonday, -1)
      };
    }

    case 'LAST_30':
      return { preset, from: addDays(today, -29), to: today };

    case 'ALL':
      return {
        preset,
        from: availableStart,
        to: availableEnd
      };

    case 'LAST_7':
    default:
      return {
        preset: 'LAST_7',
        from: addDays(today, -6),
        to: today
      };
  }
}


function operatorParts(raw = '') {
  return String(raw || '')
    .split(/\s*[,;|\n]\s*/)
    .map(x => x.trim())
    .filter(Boolean);
}

function parseOperator(raw = '') {
  const text = String(raw || '').trim();
  const m = text.match(/\[(Ops\d+)\]/i);
  const opsid = m ? m[1].toUpperCase() : '';
  const name = text.replace(/\[Ops\d+\]/gi, '').trim();
  const norm = name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();

  const invalid =
    !name ||
    /@/.test(name) ||
    ['NA', 'NOT IDENTIFIED', 'NAO IDENTIFICADO'].includes(norm);

  return invalid
    ? null
    : {
        key: opsid || norm,
        opsid,
        name,
        raw: `${opsid ? `[${opsid}]` : ''}${name}`
      };
}

function operatorMap(raw = '') {
  const map = new Map();
  operatorParts(raw).forEach(part => {
    const op = parseOperator(part);
    if (op) map.set(op.key, op);
  });
  return map;
}

function responsibility(row) {
  const pf = String(row?.process_fail || '').trim();
  const tm = String(row?.to_mis_status || '').trim();

  if (pf === 'Packed TO') return 'EXPEDIÇÃO';
  if (pf.startsWith('Extra Parcel')) return 'ESTEIRA';
  if (tm === 'Whole TO') return 'EXPEDIÇÃO';
  if (tm === 'Extra Parcel') return 'ESTEIRA';
  return 'NA';
}

function canonicalizeAndAttributeV616(rows = []) {
  const groups = new Map();

  for (const row of rows) {
    const shipment = String(row?.shipment_id || '').trim();
    if (!shipment) continue;

    // V6.16: shipment_id é a identidade física do pacote dentro do recorte.
    // Todas as linhas do mesmo BR são reunidas antes da atribuição do operador.
    const key = shipment;
    if (!groups.has(key)) groups.set(key, { rows: [], operators: new Map() });
    const g = groups.get(key);
    g.rows.push(row);

    operatorParts(row?.operator_fail).forEach(part => {
      const op = parseOperator(part);
      if (op) g.operators.set(op.key, op);
    });
  }

  const canonical = [...groups.values()].map(group => {
    const ranked = [...group.rows].sort((a, b) => {
      const score = row =>
        (responsibility(row) !== 'NA' ? 10 : 0) +
        (row?.process_fail ? 3 : 0) +
        (row?.to_mis_status ? 2 : 0) +
        (row?.socpacked_tonumber ? 1 : 0);
      return score(b) - score(a);
    });

    const base = { ...(ranked[0] || group.rows[0]) };
    const ops = [...group.operators.values()];

    base.operator_fail_original = String(
      base.operator_fail_original || base.operator_fail || 'NA'
    );

    if (ops.length === 0) {
      base.operator_fail = 'NA';
      base.attribution_source = 'NO_OPERATOR';
    } else if (ops.length === 1) {
      base.operator_fail = ops[0].raw;
      base.attribution_source = 'DIRECT_OPERATOR_FAIL';
    } else {
      base.operator_fail = ops.map(x => x.raw).join(',');
      base.attribution_source = 'MULTI_OPERATOR_SHARED';
    }

    if (!base.socpacked_tonumber) {
      base.socpacked_tonumber =
        ranked.find(x => String(x?.socpacked_tonumber || '').trim())
          ?.socpacked_tonumber || '';
    }
    if (!base.process_fail) {
      base.process_fail =
        ranked.find(x => String(x?.process_fail || '').trim())?.process_fail || '';
    }
    if (!base.to_mis_status) {
      base.to_mis_status =
        ranked.find(x => String(x?.to_mis_status || '').trim())?.to_mis_status || '';
    }

    return base;
  });

  const toContext = new Map();

  for (const row of canonical) {
    if (String(row?.to_mis_status || '').trim() !== 'Whole TO') continue;
    const to = String(row?.socpacked_tonumber || '').trim();
    if (!to) continue;

    const date = misscanDateKey(row) || 'NO_DATE';
    const key = `${date}|${to}`;
    if (!toContext.has(key)) {
      toContext.set(key, { single: new Map(), rows: 0, multi: 0 });
    }

    const ctx = toContext.get(key);
    ctx.rows++;
    const ops = operatorMap(row.operator_fail);

    if (ops.size === 1) {
      const op = [...ops.values()][0];
      ctx.single.set(op.key, op);
    } else if (ops.size > 1) {
      ctx.multi++;
    }
  }

  for (const row of canonical) {
    if (String(row?.to_mis_status || '').trim() !== 'Whole TO') continue;
    const to = String(row?.socpacked_tonumber || '').trim();
    if (!to) continue;

    const currentOps = operatorMap(row.operator_fail);
    if (currentOps.size > 0) continue;

    const date = misscanDateKey(row) || 'NO_DATE';
    const ctx = toContext.get(`${date}|${to}`);
    if (!ctx) continue;

    if (ctx.single.size === 1) {
      const op = [...ctx.single.values()][0];
      row.operator_fail = op.raw;
      row.attribution_source = 'WHOLE_TO_INHERITED';
      row.attribution_to = to;
    } else if (ctx.single.size > 1) {
      row.attribution_source = 'WHOLE_TO_CONFLICT_NOT_IDENTIFIED';
    } else {
      row.attribution_source = 'WHOLE_TO_NO_OPERATOR_NOT_IDENTIFIED';
    }
  }

  return canonical;
}

function formatBr(dateKey) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) return dateKey || '—';
  const [y, m, d] = dateKey.split('-');
  return `${d}/${m}/${y}`;
}

export async function GET(request) {
  try {
    const url = new URL(request.url);
    const meta = await readJson(META_PATH, null);
    const hcFile = await readJson(HC_PATH, { rows: [] });

    if (!meta) {
      return json({
        ok: false,
        error: 'Ainda não existe histórico sincronizado. Execute sincronizarHistoricoCompletoLMV64() no Apps Script.'
      }, 503);
    }

    if (!meta.historyStart || !meta.historyEnd) {
      return json({
        ok: false,
        error: meta?.backfill?.status === 'RUNNING'
          ? 'Backfill completo da LM em andamento. Aguarde a primeira etapa.'
          : 'O índice histórico da LM está vazio.'
      }, 503);
    }

    const period = resolvePeriod(url, meta);
    const requestedMonths = monthsBetween(period.from, period.to);

    const indexed = new Set(
      Array.isArray(meta?.months) ? meta.months : []
    );

    // V6.16: o histórico é particionado por LM Received,
    // portanto basta ler os meses efetivamente solicitados.
    const candidateMonths = [...new Set(requestedMonths)].sort();

    const months = candidateMonths.filter(
      month => indexed.size === 0 || indexed.has(month)
    );

    const rows = [];

    for (const month of months) {
      const file = await readJson(
        `misscan/history/${month}.json`,
        { rows: [] }
      );

      for (const row of (file?.rows || [])) {
        const dateKey = misscanDateKey(row);

        if (
          dateKey &&
          dateKey >= period.from &&
          dateKey <= period.to
        ) {
          rows.push(row);
        }
      }
    }

    const last = new Date(
      meta?.receivedAt ||
      meta?.updatedAt ||
      meta?.generatedAt ||
      0
    );

    const ageMinutes = Number.isFinite(last.getTime())
      ? Math.round((Date.now() - last.getTime()) / 60000)
      : null;

    const physicalPeriodRows = rows.length;
    const canonicalRows = canonicalizeAndAttributeV616(rows);

    canonicalRows.sort((a, b) =>
      misscanDateValue(a).localeCompare(misscanDateValue(b))
    );

    return json({
      ok: true,
      hc: hcFile?.rows || [],
      misscan: canonicalRows,
      meta: {
        ...meta,
        ageMinutes,
        stale: ageMinutes === null ? true : ageMinutes > 90,
        periodPreset: period.preset,
        periodStart: period.from,
        periodEnd: period.to,
        periodLabel: `${formatBr(period.from)} a ${formatBr(period.to)}`,
        historyLabel: `${formatBr(meta.historyStart)} a ${formatBr(meta.historyEnd)}`,
        returnedMisscanRecords: canonicalRows.length,
        physicalPeriodRows,
        canonicalPeriodRows: canonicalRows.length,
        v616Canonicalized: true,
        dateRule: 'LMRECEIVED_DATE',
        multiOperatorRule: 'ALL_OPERATOR_FAIL_PRESERVED',
        wholeToInheritance: true,
        brIdentityRule: 'UNIQUE_SHIPMENT_ID',
        attributionPipeline: 'GROUP_BR_THEN_COLLECT_ALL_OPERATOR_FAIL',
        historyMonths: Array.isArray(meta.months) ? meta.months.length : 0
      }
    });

  } catch (error) {
    console.error('MISSCAN_DATA_V616_ERROR', error);

    return json({
      ok: false,
      error: error?.message || 'Falha ao ler o histórico dinâmico da LM.'
    }, 500);
  }
}