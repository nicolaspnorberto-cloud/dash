import { json, readJson, normalizeName, rowDateKey, monthsBetween } from '../lib/blob-store.mjs';

const GEROT_PATH = 'misscan/gerot.json';
const HC_PATH = 'misscan/hc.json';
const META_PATH = 'misscan/history-meta.json';
const TARGET = 0.88;

function addDays(key, days) {
  const d = new Date(`${key}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function blockForTurn(value = '') {
  const turns = [...new Set(String(value || '').toUpperCase().match(/T[1-5]/g) || [])];
  const blocks = [...new Set(
    turns
      .map(t => t === 'T4' ? 'T2' : t === 'T5' ? 'T3' : t)
      .filter(t => ['T1', 'T2', 'T3'].includes(t))
  )];
  return blocks.length === 1 ? blocks[0] : '';
}

function identifiedOperator(raw = '') {
  const text = String(raw || '').trim();
  if (!text || text.includes(',')) return '';
  const clean = text.replace(/\[Ops\d+\]/gi, ' ').trim();
  const norm = normalizeName(clean);
  if (
    !norm ||
    /@/.test(clean) ||
    ['NA', 'NOT IDENTIFIED', 'NAO IDENTIFICADO'].includes(norm)
  ) return '';
  return norm;
}

function fmtBr(k = '') {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(k)) return k || '—';
  const [y, m, d] = k.split('-');
  return `${d}/${m}/${y}`;
}

function minDate(...values) {
  const dates = values
    .filter(v => /^\d{4}-\d{2}-\d{2}$/.test(String(v || '')))
    .sort();
  return dates[0] || '';
}

function maxDate(rows = []) {
  return rows
    .map(r => String(r?.date || ''))
    .filter(v => /^\d{4}-\d{2}-\d{2}$/.test(v))
    .sort()
    .at(-1) || '';
}

function emptyBlocks() {
  return {
    T1: { misscan: 0, volumeReal: 0 },
    T2: { misscan: 0, volumeReal: 0 },
    T3: { misscan: 0, volumeReal: 0 }
  };
}

export async function GET(request) {
  try {
    const url = new URL(request.url);
    const days = Math.max(
      1,
      Math.min(90, Number(url.searchParams.get('days') || 14))
    );

    const gerot = await readJson(GEROT_PATH, null);
    const hcFile = await readJson(HC_PATH, { rows: [] });
    const histMeta = await readJson(META_PATH, null);

    if (!gerot?.forecast?.length) {
      return json({
        ok: false,
        error: 'Forecast INTER-SOC da GEROT ainda não sincronizado. Execute sincronizarGerotV65().'
      }, 503);
    }

    if (!histMeta) {
      return json({
        ok: false,
        error: 'Histórico Misscan ainda não sincronizado.'
      }, 503);
    }

    // V6.6: a taxa geral e o casamento diário usam o Total (F)
    // do origin_type INTER-SOC da db_volume_forecast.
    const forecastEnd = gerot.meta?.forecastEnd || maxDate(gerot.forecast);
    const missEnd = String(histMeta.historyEnd || '');
    const end = minDate(forecastEnd, missEnd) || forecastEnd || missEnd;
    const start = addDays(end, -(days - 1));

    const hcMap = new Map();
    for (const h of (hcFile.rows || [])) {
      hcMap.set(
        normalizeName(h?.colaborador || h?.norm || ''),
        h
      );
    }

    // Base diária oficial da taxa geral: Forecast INTER-SOC Total (F).
    const forecastDaily = new Map();
    for (const r of (gerot.forecast || [])) {
      if (!r?.date || r.date < start || r.date > end) continue;
      const total = Math.max(0, Number(r.total || 0));
      if (total <= 0) continue;
      forecastDaily.set(r.date, {
        week: r.week || '',
        total
      });
    }

    // Os blocos históricos continuam usando SOC_Packed Inter-SOC por turno
    // apenas para referência T1 / T2+T4 / T3+T5.
    const processedDaily = new Map();
    for (const r of (gerot.processed || [])) {
      if (!r?.date || r.date < start || r.date > end) continue;
      const block = blockForTurn(r.turno);
      if (!block) continue;

      if (!processedDaily.has(r.date)) {
        processedDaily.set(r.date, {
          week: r.week || '',
          blocks: { T1: 0, T2: 0, T3: 0 }
        });
      }

      const d = processedDaily.get(r.date);
      d.blocks[block] += Math.max(0, Number(r.socPacked || 0));
      if (!d.week && r.week) d.week = r.week;
    }

    const missAllByDate = new Map();
    const missBlockByDate = new Map();
    let unidentified = 0;
    let withoutHC = 0;
    let identifiedForBlocks = 0;

    const indexedMonths = new Set(
      Array.isArray(histMeta.months) ? histMeta.months : []
    );
    const months = monthsBetween(start, end).filter(
      month => indexedMonths.size === 0 || indexedMonths.has(month)
    );

    for (const month of months) {
      const f = await readJson(
        `misscan/history/${month}.json`,
        { rows: [] }
      );

      for (const row of (f.rows || [])) {
        const date = rowDateKey(row);
        if (!date || date < start || date > end) continue;

        missAllByDate.set(
          date,
          (missAllByDate.get(date) || 0) + 1
        );

        const op = identifiedOperator(row?.operator_fail || '');
        if (!op) {
          unidentified++;
          continue;
        }

        const hc = hcMap.get(op);
        if (!hc) {
          withoutHC++;
          continue;
        }

        const block = blockForTurn(hc.turno || '');
        if (!block) {
          withoutHC++;
          continue;
        }

        if (!missBlockByDate.has(date)) {
          missBlockByDate.set(
            date,
            { T1: 0, T2: 0, T3: 0 }
          );
        }

        missBlockByDate.get(date)[block]++;
        identifiedForBlocks++;
      }
    }

    const sums = emptyBlocks();
    const general = { misscan: 0, volumeReal: 0 };
    const daily = [];
    let pendingMisscanNoProcessed = 0;

    const allDates = [...new Set([
      ...forecastDaily.keys(),
      ...missAllByDate.keys()
    ])].sort();

    for (const date of allDates) {
      if (date < start || date > end) continue;

      const forecast = forecastDaily.get(date);
      const allMiss = missAllByDate.get(date) || 0;

      if (!forecast || Number(forecast.total || 0) <= 0) {
        pendingMisscanNoProcessed += allMiss;
        continue;
      }

      const dayVolume = Number(forecast.total || 0);
      const blockProcessed = processedDaily.get(date);
      const blockMiss = missBlockByDate.get(date) || {
        T1: 0,
        T2: 0,
        T3: 0
      };

      const blocks = {};

      for (const t of ['T1', 'T2', 'T3']) {
        const volumeReal = Number(
          blockProcessed?.blocks?.[t] || 0
        );
        const misscan = Number(blockMiss[t] || 0);
        const rate = volumeReal > 0
          ? misscan / volumeReal * 100
          : null;

        blocks[t] = {
          misscan,
          volumeReal,
          rate,
          source: 'SOC_Packed Inter-SOC'
        };

        if (volumeReal > 0) {
          sums[t].misscan += misscan;
          sums[t].volumeReal += volumeReal;
        }
      }

      general.misscan += allMiss;
      general.volumeReal += dayVolume;

      daily.push({
        date,
        week: forecast.week || blockProcessed?.week || '',
        misscan: allMiss,
        volumeReal: dayVolume,
        rate: allMiss / dayVolume * 100,
        target: TARGET,
        volumeSource: 'db_volume_forecast • INTER-SOC • Total (F)',
        blocks
      });
    }

    const rates = {};
    for (const t of ['T1', 'T2', 'T3']) {
      rates[t] = {
        turno: t,
        misscan: sums[t].misscan,
        volumeReal: sums[t].volumeReal,
        rate: sums[t].volumeReal > 0
          ? sums[t].misscan / sums[t].volumeReal * 100
          : null,
        source: 'db_volume_overall • Inter-SOC • SOC_Packed'
      };
    }

    rates.T4 = {
      ...rates.T2,
      turno: 'T4',
      mappedTo: 'T2'
    };
    rates.T5 = {
      ...rates.T3,
      turno: 'T5',
      mappedTo: 'T3'
    };

    const weeklyMap = new Map();
    for (const d of daily) {
      const key = d.week || d.date.slice(0, 7);
      if (!weeklyMap.has(key)) {
        weeklyMap.set(key, {
          week: key,
          misscan: 0,
          volumeReal: 0,
          days: 0
        });
      }
      const w = weeklyMap.get(key);
      w.misscan += d.misscan;
      w.volumeReal += d.volumeReal;
      w.days++;
    }

    const weekly = [...weeklyMap.values()].map(w => ({
      ...w,
      rate: w.volumeReal > 0
        ? w.misscan / w.volumeReal * 100
        : null,
      target: TARGET,
      volumeSource: 'Forecast INTER-SOC Total (F)'
    }));

    const generalRate = general.volumeReal > 0
      ? general.misscan / general.volumeReal * 100
      : null;

    return json({
      ok: true,
      version: '6.6',
      days,
      start,
      end,
      periodLabel: `${fmtBr(start)} a ${fmtBr(end)}`,
      target: TARGET,
      rates,
      general: {
        ...general,
        rate: generalRate,
        target: TARGET,
        gapPp: Number.isFinite(generalRate)
          ? generalRate - TARGET
          : null,
        unidentified,
        withoutHC,
        identifiedForBlocks,
        pendingMisscanNoProcessed,
        volumeSource: 'db_volume_forecast • INTER-SOC • Total (F)'
      },
      mapping: {
        T1: 'T1',
        T2: 'T2 + T4',
        T3: 'T3 + T5',
        T4: 'T2',
        T5: 'T3'
      },
      source: 'Matinal/LM ÷ GEROT db_volume_forecast • INTER-SOC • Total (F)',
      blockSource: 'GEROT db_volume_overall • Inter-SOC • SOC_Packed',
      productionMeta: gerot.meta || {},
      misscanMeta: {
        historyStart: histMeta.historyStart,
        historyEnd: histMeta.historyEnd
      },
      daily,
      weekly
    });

  } catch (error) {
    console.error('TAXAS_V66_ERROR', error);
    return json({
      ok: false,
      error: error?.message || 'Falha ao calcular taxas V6.6.'
    }, 500);
  }
}
