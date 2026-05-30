import { toZonedTime, fromZonedTime, formatInTimeZone } from 'date-fns-tz';

export const TZ_CHILE = 'America/Santiago';

// Convierte una fecha UTC a su representación en hora local de Chile.
// No ajusta la zona del objeto Date; simplemente desplaza los campos
// (getHours, getMinutes, etc.) al horario chileno.
export function toLocalChile(utc: Date): Date {
  return toZonedTime(utc, TZ_CHILE);
}

// Retorna la fecha local chilena de una marca UTC como string 'YYYY-MM-DD'.
export function fechaLocalChile(utc: Date): string {
  return formatInTimeZone(utc, TZ_CHILE, 'yyyy-MM-dd');
}

// Día de la semana ISO (lunes=1, domingo=7) de una fecha ya localizada.
export function diaSemanaIso(localDate: Date): number {
  const d = localDate.getDay(); // 0=domingo
  return d === 0 ? 7 : d;
}

// Retorna el lunes 00:00 UTC de la semana ISO que contiene `utc`.
export function inicioSemanaIso(utc: Date): Date {
  const local = toLocalChile(utc);
  const dia = diaSemanaIso(local);
  const lunes = new Date(local);
  lunes.setDate(local.getDate() - (dia - 1));
  lunes.setHours(0, 0, 0, 0);
  return fromZonedTime(lunes, TZ_CHILE);
}

// Convierte un string 'HH:MM:SS' (hora local pactada) a minutos desde medianoche.
export function timeStrToMinutos(t: string): number {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + (m ?? 0);
}

// Convierte una fecha UTC a minutos desde medianoche en hora local Chile.
export function utcToMinutosLocales(utc: Date): number {
  const local = toLocalChile(utc);
  return local.getHours() * 60 + local.getMinutes();
}

// Genera un arreglo de strings 'YYYY-MM-DD' para los 7 días de la semana ISO
// que empieza en el lunes dado (string 'YYYY-MM-DD').
export function diasDeSemana(lunesStr: string): string[] {
  const result: string[] = [];
  const [y, m, d] = lunesStr.split('-').map(Number);
  for (let i = 0; i < 7; i++) {
    const fecha = new Date(Date.UTC(y, m - 1, d + i));
    result.push(fecha.toISOString().slice(0, 10));
  }
  return result;
}
