export type Coordenadas = {
  latitud: number;
  longitud: number;
  precisionMetros: number;
};

export async function obtenerCoordenadas(): Promise<Coordenadas> {
  if (!('geolocation' in navigator)) {
    throw new Error('Tu navegador no soporta geolocalización.');
  }

  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(
      (pos) =>
        resolve({
          latitud: pos.coords.latitude,
          longitud: pos.coords.longitude,
          precisionMetros: pos.coords.accuracy,
        }),
      (err) => {
        const mensajes: Record<number, string> = {
          1: 'Permiso de ubicación denegado. Habilítalo en la configuración del navegador para poder marcar.',
          2: 'No pudimos obtener tu ubicación. Verifica que el GPS esté activo.',
          3: 'La búsqueda de tu ubicación tardó demasiado. Inténtalo de nuevo.',
        };
        reject(new Error(mensajes[err.code] ?? 'Error desconocido obteniendo ubicación.'));
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 },
    );
  });
}
