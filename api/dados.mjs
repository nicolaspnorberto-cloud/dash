import { withReportCache } from '../lib/report-cache.mjs';
import { sourceRevision } from '../lib/source-revision.mjs';
import {
  json,
  readJson,
  readHistoryRange,
  rowDateKey,
} from '../lib/blob-store.mjs';

const HC_PATH = 'misscan/hc.json';
const META_PATH = 'misscan/history-meta.json';

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

  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(new Date());

  const availableStart = meta?.historyStart || today;
  const availableEnd = meta?.historyEnd || today;

  if (/^\d{4}-\d{2}-\d{2}$/.test(customFrom) && /^\d{4}-\d{2}-\d{2}$/.test(customTo)) {
    return {
      preset: 'CUSTOM',
      from: customFrom <= customTo ? customFrom : customTo,
      to: customFrom <= customTo ? customTo : customFrom
    };
  }

  switch (preset) {
    case 'TODAY': return { preset, from: today, to: today };
    case 'YESTERDAY': {
      const y = addDays(today, -1);
      return { preset, from: y, to: y };
    }
    case 'CURRENT_WEEK': return { preset, from: mondayOf(today), to: today };
    case 'PREVIOUS_WEEK': {
      const currentMonday = mondayOf(today);
      return { preset, from: addDays(currentMonday, -7), to: addDays(currentMonday, -1) };
    }
    case 'LAST_30': return { preset, from: addDays(today, -29), to: today };
    case 'ALL': return { preset, from: availableStart, to: availableEnd };
    case 'LAST_7':
    default: {
      // Durante a migração, ou quando a fonte atrasa, mostra os sete dias mais
      // recentes realmente disponíveis em vez de entregar um painel vazio.
      const anchor = availableEnd && availableEnd < today ? availableEnd : today;
      return { preset: 'LAST_7', from: addDays(anchor, -6), to: anchor };
    }
  }
}

function normalizeName(value = '') {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
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
  const opsid = m ? m[1].toUpperCase() : (/^Ops\d+$/i.test(text) ? text.toUpperCase() : '');
  const name = text.replace(/\[Ops\d+\]/gi, '').trim();
  const norm = normalizeName(name);
  const invalid = !name || /@/.test(name) || /^OPS\d+$/i.test(text) ||
    ['NA','NOT IDENTIFIED','NAO IDENTIFICADO'].includes(norm);
  if (invalid) return null;

  return {
    key: opsid || norm,
    opsid,
    name,
    raw: `${opsid ? `[${opsid}]` : ''}${name}`
  };
}

function validOperators(raw = '') {
  const map = new Map();
  for (const part of operatorParts(raw)) {
    const op = parseOperator(part);
    if (op) map.set(op.key, op);
  }
  return [...map.values()];
}

// Mantém na resposta somente os campos usados pelo dashboard. A LM possui
// dezenas de colunas e devolver todas elas fazia períodos com mais de um dia
// ultrapassarem o limite de CPU do Worker gratuito durante o JSON.stringify.
function compactSourceRow(row = {}) {
  return {
    shipment_id: String(row?.shipment_id || '').trim(),
    lmreceived_date: String(row?.lmreceived_date || ''),
    lmreceived_station: String(row?.lmreceived_station || ''),
    socpacked_tonumber: String(row?.socpacked_tonumber || ''),
    process_fail: String(row?.process_fail || ''),
    to_mis_status: String(row?.to_mis_status || ''),
    operator_fail: String(row?.operator_fail || ''),
    last_status: String(row?.last_status || ''),
    is_misrouting: String(
      row?.is_misrouting ?? row?.is_mis_routing ??
      row?.misrouting ?? row?.mis_routing ?? ''
    )
  };
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

const MANUAL = {
  key: 'OPS0',
  opsid: 'OPS0',
  name: 'MANUAL',
  raw: '[Ops0]MANUAL'
};

function choosePackedOwner(ctx) {
  if (!ctx) return null;

  const ranked = [...ctx.singleEvidence.values()]
    .sort((a, b) => b.count - a.count || a.op.name.localeCompare(b.op.name, 'pt-BR'));

  if (ranked.length === 1) return ranked[0].op;

  if (ranked.length > 1) {
    if (ranked[0].count > ranked[1].count) return ranked[0].op;
    return MANUAL;
  }

  if (ctx.multiRows > 0) return MANUAL;
  return null;
}

function attributeDynamicV613(rows = []) {
  const source = rows.map((row, index) => ({
    ...compactSourceRow(row),
    shipment_id_original: String(row?.shipment_id || '').trim(),
    __lm_row_index: index
  }));

  const packed = new Map();

  for (const row of source) {
    if (responsibility(row) !== 'EXPEDIÇÃO') continue;

    const to = String(row?.socpacked_tonumber || '').trim();
    if (!to) continue;

    const date = rowDateKey(row) || 'NO_DATE';
    const key = `${date}|${to}`;

    if (!packed.has(key)) {
      packed.set(key, {
        rows: 0,
        multiRows: 0,
        singleEvidence: new Map()
      });
    }

    const ctx = packed.get(key);
    ctx.rows++;

    const valid = validOperators(row?.operator_fail);

    if (valid.length >= 2) {
      ctx.multiRows++;
      continue;
    }

    if (valid.length === 1) {
      const op = valid[0];
      const current = ctx.singleEvidence.get(op.key) || { op, count: 0 };
      current.count++;
      ctx.singleEvidence.set(op.key, current);
    }
  }

  const packedOwner = new Map();
  for (const [key, ctx] of packed.entries()) {
    packedOwner.set(key, choosePackedOwner(ctx));
  }

  return source.map((row, index) => {
    const out = { ...row };
    const originalShipment = String(out.shipment_id_original || '').trim();

    // Cada linha da LM = 1 Miss Scan.
    // A chave técnica evita que o frontend V6.12 reduza linhas repetidas.
    out.shipment_id = `${originalShipment || 'SEM_BR'}#LM${String(index + 1).padStart(6, '0')}`;
    out.operator_fail_original = String(out.operator_fail || 'NA');
    out.attribution_rule_version = 'V6.13-DYNAMIC';

    const area = responsibility(out);
    const valid = validOperators(out.operator_fail_original);

    if (area === 'ESTEIRA') {
      if (valid.length >= 2) {
        out.operator_fail = MANUAL.raw;
        out.attribution_source = 'EXTRA_MULTI_OPERATOR_MANUAL';
      } else if (valid.length === 1) {
        out.operator_fail = valid[0].raw;
        out.attribution_source = 'EXTRA_SINGLE_OPERATOR';
      } else {
        out.operator_fail = 'NA';
        out.attribution_source = 'EXTRA_NO_OPERATOR';
      }
      return out;
    }

    if (area === 'EXPEDIÇÃO') {
      const to = String(out.socpacked_tonumber || '').trim();

      if (to) {
        const date = rowDateKey(out) || 'NO_DATE';
        const owner = packedOwner.get(`${date}|${to}`);

        if (owner) {
          out.operator_fail = owner.raw;
          out.attribution_source = owner.key === MANUAL.key
            ? 'PACKED_TO_MANUAL'
            : 'PACKED_TO_PROPAGATED';
          out.attribution_to = to;
        } else if (valid.length >= 2) {
          out.operator_fail = MANUAL.raw;
          out.attribution_source = 'PACKED_MULTI_OPERATOR_MANUAL';
        } else if (valid.length === 1) {
          out.operator_fail = valid[0].raw;
          out.attribution_source = 'PACKED_SINGLE_FALLBACK';
        } else {
          out.operator_fail = 'NA';
          out.attribution_source = 'PACKED_NO_OPERATOR';
        }
      } else if (valid.length >= 2) {
        out.operator_fail = MANUAL.raw;
        out.attribution_source = 'EXPEDICAO_MULTI_OPERATOR_MANUAL';
      } else if (valid.length === 1) {
        out.operator_fail = valid[0].raw;
        out.attribution_source = 'EXPEDICAO_SINGLE_OPERATOR';
      } else {
        out.operator_fail = 'NA';
        out.attribution_source = 'EXPEDICAO_NO_OPERATOR';
      }

      return out;
    }

    if (valid.length >= 2) {
      out.operator_fail = MANUAL.raw;
      out.attribution_source = 'MULTI_OPERATOR_MANUAL';
    } else if (valid.length === 1) {
      out.operator_fail = valid[0].raw;
      out.attribution_source = 'DIRECT_SINGLE_OPERATOR';
    } else {
      out.operator_fail = 'NA';
      out.attribution_source = 'NO_OPERATOR';
    }

    return out;
  });
}

function rankingPreview(rows = []) {
  const map = new Map();

  for (const row of rows) {
    const ops = validOperators(row.operator_fail);
    if (ops.length !== 1) continue;

    const op = ops[0];

    if (!map.has(op.key)) {
      map.set(op.key, {
        colaborador: op.name,
        opsid: op.opsid,
        miss_scan: 0,
        esteira: 0,
        expedicao: 0
      });
    }

    const item = map.get(op.key);
    item.miss_scan++;

    const area = responsibility(row);
    if (area === 'ESTEIRA') item.esteira++;
    if (area === 'EXPEDIÇÃO') item.expedicao++;
  }

  return [...map.values()]
    .sort((a,b) => b.miss_scan - a.miss_scan ||
      a.colaborador.localeCompare(b.colaborador, 'pt-BR'));
}

function formatBr(dateKey) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) return dateKey || '—';
  const [y, m, d] = dateKey.split('-');
  return `${d}/${m}/${y}`;
}

// Reutilizado pela matriz semanal para garantir a mesma atribuição do ranking.
export { attributeDynamicV613, responsibility, validOperators, resolvePeriod };

const cachedReport=withReportCache(buildReport);
export async function GET(request){
  if(new URL(request.url).searchParams.get('revision')==='1')return sourceRevision(request);
  return cachedReport(request);
}

async function buildReport(request) {
  try {
    const url = new URL(request.url);
    const includeHC = url.searchParams.get('include_hc') !== '0';
    const metaOnly = url.searchParams.get('meta_only') === '1';
    const [meta, hcFile] = await Promise.all([
      readJson(META_PATH, null),
      includeHC ? readJson(HC_PATH, { rows: [] }) : Promise.resolve({ rows: [] })
    ]);

    if (!meta) {
      return json({ ok:false, error:'Ainda não existe histórico sincronizado.' }, 503);
    }

    if (!meta.historyStart || !meta.historyEnd) {
      return json({ ok:false, error:'O índice histórico da LM está vazio.' }, 503);
    }

    const period = resolvePeriod(url, meta);
    const last = new Date(
      meta?.receivedAt || meta?.updatedAt || meta?.generatedAt || 0
    );
    const ageMinutes = Number.isFinite(last.getTime())
      ? Math.round((Date.now() - last.getTime()) / 60000)
      : null;
    const reportMeta = {
      ...meta,
      ageMinutes,
      stale: ageMinutes === null ? true : ageMinutes > 90,
      periodPreset: period.preset,
      periodStart: period.from,
      periodEnd: period.to,
      periodLabel: `${formatBr(period.from)} a ${formatBr(period.to)}`,
      historyLabel: `${formatBr(meta.historyStart)} a ${formatBr(meta.historyEnd)}`
    };

    // Primeira chamada do navegador: carrega somente índice + HC. Os BRs são
    // buscados em blocos menores para que um período grande nunca derrube o
    // Worker inteiro por limite de CPU.
    if (metaOnly) {
      return json({
        ok: true,
        hc: hcFile?.rows || [],
        misscan: [],
        rankingPreview: [],
        meta: {
          ...reportMeta,
          metaOnly: true,
          physicalPeriodRows: 0,
          returnedMisscanRecords: 0,
          manualRows: 0,
          ruleVersion: 'V6.13-DYNAMIC'
        }
      });
    }

    const rows = await readHistoryRange(period.from, period.to, meta);

    const attributed = attributeDynamicV613(rows);

    attributed.sort((a,b) =>
      String(a.lmreceived_date || '').localeCompare(String(b.lmreceived_date || ''))
    );

    const manualRows = attributed.filter(
      r => validOperators(r.operator_fail)[0]?.key === MANUAL.key
    ).length;

    return json({
      ok: true,
      hc: hcFile?.rows || [],
      misscan: attributed,
      rankingPreview: rankingPreview(attributed),
      meta: {
        ...reportMeta,
        physicalPeriodRows: rows.length,
        returnedMisscanRecords: attributed.length,
        manualRows,
        ruleVersion: 'V6.13-DYNAMIC',
        oneLmRowOneMisscan: true,
        multiOperatorManual: true,
        packedToPropagation: true,
        hardcodedOffenders: false
      }
    });

  } catch (error) {
    console.error('MISSCAN_DATA_V613_ERROR', error);

    return json({
      ok:false,
      error:error?.message || 'Falha ao aplicar regra dinâmica V6.13.'
    }, 500);
  }
}
