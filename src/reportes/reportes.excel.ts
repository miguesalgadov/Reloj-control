import ExcelJS from 'exceljs';

const CREATOR = 'Reloj Control InnovaDX';

function headerStyle(ws: ExcelJS.Worksheet, row: number, cols: number): void {
  const r = ws.getRow(row);
  for (let c = 1; c <= cols; c++) {
    const cell = r.getCell(c);
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4338CA' } };
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
  }
  r.height = 20;
}

// ─── Reporte 1: Asistencia detallada ────────────────────────────────────────

export async function generarExcelAsistencia(datos: ReturnType<any>): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = CREATOR;
  wb.created = new Date();

  // Pestaña Resumen
  const wsRes = wb.addWorksheet('Resumen');
  wsRes.columns = [
    { header: 'Período', key: 'periodo', width: 20 },
    { header: 'Valor', key: 'valor', width: 35 },
  ];
  wsRes.addRow([datos.periodo.nombre_mes, datos.tenant.razon_social]);
  wsRes.addRow(['Trabajadores evaluados', datos.totales_periodo.trabajadores_evaluados]);
  wsRes.addRow(['Total horas ordinarias', datos.totales_periodo.total_horas_ordinarias]);
  wsRes.addRow(['Total horas extra', datos.totales_periodo.total_horas_extra]);
  wsRes.addRow(['Total días trabajados', datos.totales_periodo.total_dias_trabajados]);
  wsRes.addRow(['Total atrasos (min)', datos.totales_periodo.total_atrasos_minutos]);

  // Pestaña por trabajador
  for (const t of datos.trabajadores) {
    const wsName = (t.trabajador.rut as string).replace(/[^a-z0-9\-]/gi, '').slice(0, 31);
    const ws = wb.addWorksheet(wsName);

    // Info trabajador (rows 1-3)
    ws.addRow([`Trabajador: ${t.trabajador.nombres} ${t.trabajador.apellido_paterno}`]);
    ws.addRow([`RUT: ${t.trabajador.rut}  |  Centro: ${t.trabajador.centro_trabajo_nombre ?? '—'}`]);
    ws.addRow([`Período: ${datos.periodo.nombre_mes}`]);
    ws.addRow([]); // spacer

    // Headers de tabla
    const COLS = ['Fecha', 'Día', 'Entrada', 'Inicio Col.', 'Fin Col.', 'Salida', 'Atraso (min)', 'Horas Trab.', 'Horas Extra', 'Observaciones'];
    ws.addRow(COLS);
    headerStyle(ws, 5, COLS.length);
    ws.columns = [
      { key: 'fecha', width: 12 }, { key: 'dia', width: 12 }, { key: 'entrada', width: 10 },
      { key: 'inicio_col', width: 10 }, { key: 'fin_col', width: 10 }, { key: 'salida', width: 10 },
      { key: 'atraso', width: 12 }, { key: 'horas', width: 12 }, { key: 'extra', width: 12 },
      { key: 'obs', width: 40 },
    ];

    for (const d of t.dias) {
      const m = d.marcaciones as Array<{ tipo: string; hora_local: string }>;
      const getMarca = (tipo: string) => m.find(x => x.tipo === tipo)?.hora_local ?? '';
      ws.addRow([
        d.fecha, d.dia_semana,
        getMarca('entrada'), getMarca('inicio_colacion'), getMarca('fin_colacion'), getMarca('salida'),
        d.evaluacion.atraso_minutos || '',
        d.evaluacion.horas_trabajadas != null ? d.evaluacion.horas_trabajadas : '',
        d.evaluacion.horas_extra || '',
        d.evaluacion.observaciones,
      ]);
    }

    // Fila totales
    const totRow = ws.addRow([
      'TOTALES', '',
      `Trabajados: ${t.totales_mes.dias_trabajados}`, '', '', '',
      t.totales_mes.atrasos_total_minutos,
      t.totales_mes.horas_ordinarias_total,
      t.totales_mes.horas_extra_total,
      `Ausentes: ${t.totales_mes.dias_ausente}`,
    ]);
    totRow.font = { bold: true };
    ws.views = [{ state: 'frozen', ySplit: 5 }];
  }

  return wb.xlsx.writeBuffer() as Promise<Buffer>;
}

// ─── Reporte 2: Resumen trabajadores ────────────────────────────────────────

export async function generarExcelResumenTrabajadores(datos: ReturnType<any>): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = CREATOR;
  wb.created = new Date();
  const ws = wb.addWorksheet('Resumen Trabajadores');

  ws.addRow([`Resumen mensual de trabajadores — ${datos.periodo.nombre_mes}`]);
  ws.addRow([datos.tenant.razon_social]);
  ws.addRow([]);

  const COLS = ['RUT', 'Nombre Completo', 'Centro', 'Días Trab.', 'Horas Ord.', 'Horas Extra', 'Atrasos (min)', 'Inasistencias', 'Observaciones'];
  ws.addRow(COLS);
  headerStyle(ws, 4, COLS.length);

  ws.columns = [
    { key: 'rut', width: 14 }, { key: 'nombre', width: 30 }, { key: 'centro', width: 28 },
    { key: 'dias', width: 10 }, { key: 'horas', width: 12 }, { key: 'extra', width: 12 },
    { key: 'atrasos', width: 14 }, { key: 'inas', width: 14 }, { key: 'obs', width: 40 },
  ];

  for (const t of datos.trabajadores) {
    ws.addRow([
      t.trabajador.rut, t.trabajador.nombre_completo, t.trabajador.centro_trabajo ?? '—',
      t.totales.dias_trabajados, t.totales.horas_ordinarias, t.totales.horas_extra,
      t.totales.atrasos_total_minutos, t.totales.dias_ausentes, t.observaciones,
    ]);
  }

  const totRow = ws.addRow([
    'TOTAL', '', '',
    datos.trabajadores.reduce((s: number, t: any) => s + t.totales.dias_trabajados, 0),
    datos.trabajadores.reduce((s: number, t: any) => s + t.totales.horas_ordinarias, 0),
    datos.trabajadores.reduce((s: number, t: any) => s + t.totales.horas_extra, 0),
    datos.trabajadores.reduce((s: number, t: any) => s + t.totales.atrasos_total_minutos, 0),
    datos.trabajadores.reduce((s: number, t: any) => s + t.totales.dias_ausentes, 0),
    '',
  ]);
  totRow.font = { bold: true };

  ws.views = [{ state: 'frozen', ySplit: 4 }];
  return wb.xlsx.writeBuffer() as Promise<Buffer>;
}

// ─── Reporte 3: Resumen centros ──────────────────────────────────────────────

export async function generarExcelResumenCentros(datos: ReturnType<any>): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = CREATOR;
  wb.created = new Date();
  const ws = wb.addWorksheet('Resumen Centros');

  ws.addRow([`Resumen mensual por centro — ${datos.periodo.nombre_mes}`]);
  ws.addRow([datos.tenant.razon_social]);
  ws.addRow([]);

  const COLS = ['Centro', 'Trabajadores', 'Horas Ord.', 'Horas Extra', 'Asistencia %', 'Atrasos (min)', 'Fuera Geocerca'];
  ws.addRow(COLS);
  headerStyle(ws, 4, COLS.length);

  ws.columns = [
    { key: 'centro', width: 32 }, { key: 'trab', width: 14 }, { key: 'horas', width: 12 },
    { key: 'extra', width: 12 }, { key: 'asist', width: 14 }, { key: 'atrasos', width: 14 },
    { key: 'geocerca', width: 16 },
  ];

  for (const c of datos.centros) {
    ws.addRow([
      c.centro.nombre, c.trabajadores_activos,
      c.totales.horas_ordinarias_total, c.totales.horas_extra_total,
      c.totales.asistencia_promedio_porcentaje,
      c.totales.atrasos_total_minutos, c.totales.marcajes_fuera_geocerca,
    ]);
  }

  ws.views = [{ state: 'frozen', ySplit: 4 }];
  return wb.xlsx.writeBuffer() as Promise<Buffer>;
}

// ─── Reporte 4: Libro de asistencia ─────────────────────────────────────────

const COLOR_P = 'FFD4EDDA';   // verde claro
const COLOR_A = 'FFF8D7DA';   // rojo claro
const COLOR_T = 'FFFFF3CD';   // amarillo
const COLOR_NOLAB = 'FFE9ECEF'; // gris claro

function colorLetra(letra: string): string {
  if (letra === 'P') return COLOR_P;
  if (letra === 'A') return COLOR_A;
  if (letra === 'T') return COLOR_T;
  return COLOR_NOLAB;
}

export async function generarExcelLibroAsistencia(datos: ReturnType<any>): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = CREATOR;
  wb.created = new Date();
  const ws = wb.addWorksheet('Libro Asistencia');

  // Header row
  const headerCols = ['RUT', 'Nombre', 'Centro', ...datos.dias_mes.map((d: any) => `${d.dia}\n${d.dia_semana}`), 'Pres.', 'Aus.', 'Atraso', 'No Lab.'];
  ws.addRow(headerCols);
  headerStyle(ws, 1, headerCols.length);
  ws.getRow(1).height = 28;

  // Fixed columns widths
  ws.getColumn(1).width = 14;  // RUT
  ws.getColumn(2).width = 28;  // Nombre
  ws.getColumn(3).width = 22;  // Centro
  for (let i = 4; i <= 3 + datos.dias_mes.length; i++) ws.getColumn(i).width = 5;
  ws.getColumn(4 + datos.dias_mes.length).width = 8;     // Pres
  ws.getColumn(5 + datos.dias_mes.length).width = 8;     // Aus
  ws.getColumn(6 + datos.dias_mes.length).width = 8;     // Atraso
  ws.getColumn(7 + datos.dias_mes.length).width = 8;     // No lab

  // Data rows
  for (const fila of datos.filas) {
    const diasArr = datos.dias_mes.map((d: any) => fila.dias[d.fecha] ?? '—');
    const row = ws.addRow([
      fila.trabajador.rut,
      fila.trabajador.nombre_completo,
      fila.trabajador.centro_trabajo ?? '—',
      ...diasArr,
      fila.totales.P,
      fila.totales.A,
      fila.totales.atraso,
      fila.totales['—'],
    ]);

    // Color each day cell
    for (let i = 0; i < diasArr.length; i++) {
      const cell = row.getCell(4 + i);
      const letra = diasArr[i];
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: colorLetra(letra) } };
      cell.alignment = { horizontal: 'center', vertical: 'middle' };
      cell.font = { bold: letra === 'A' || letra === 'T' };
    }
  }

  // Freeze header row + first 3 columns
  ws.views = [{ state: 'frozen', ySplit: 1, xSplit: 3 }];

  return wb.xlsx.writeBuffer() as Promise<Buffer>;
}
