export interface StreetViewFetchResult {
  status: 'ok' | 'no_imagery' | 'no_address' | 'api_unconfigured' | 'error';
  address_used: string | null;
  /** JPEG bytes when status is ok */
  image_bytes?: Buffer;
  error_message?: string;
}

export function getGoogleMapsApiKey(): string | null {
  const key = process.env.GOOGLE_MAPS_API_KEY?.trim();
  return key || null;
}

export function formatResidenceAddress(residence: {
  line1: string;
  line2?: string;
  city: string;
  state: string;
  zip: string;
}): string | null {
  const line1 = residence.line1?.trim();
  const city = residence.city?.trim();
  const state = (residence.state?.trim() || 'FL').toUpperCase();
  const zip = residence.zip?.trim();
  if (!line1 || !city) return null;
  const line2 = residence.line2?.trim();
  const street = line2 ? `${line1} ${line2}` : line1;
  return [street, city, state, zip].filter(Boolean).join(', ');
}

async function streetViewMetadata(
  location: string,
  apiKey: string,
): Promise<{ ok: boolean; status: string }> {
  const url = new URL('https://maps.googleapis.com/maps/api/streetview/metadata');
  url.searchParams.set('location', location);
  url.searchParams.set('key', apiKey);

  const res = await fetch(url.toString());
  if (!res.ok) {
    return { ok: false, status: `http_${res.status}` };
  }
  const data = (await res.json()) as { status?: string };
  return { ok: data.status === 'OK', status: String(data.status ?? 'UNKNOWN') };
}

export async function fetchStreetViewImage(
  residence: {
    line1: string;
    line2?: string;
    city: string;
    state: string;
    zip: string;
  },
): Promise<StreetViewFetchResult> {
  const address = formatResidenceAddress(residence);
  if (!address) {
    return { status: 'no_address', address_used: null };
  }

  const apiKey = getGoogleMapsApiKey();
  if (!apiKey) {
    return {
      status: 'api_unconfigured',
      address_used: address,
      error_message: 'GOOGLE_MAPS_API_KEY is not configured',
    };
  }

  try {
    const meta = await streetViewMetadata(address, apiKey);
    if (!meta.ok) {
      return {
        status: 'no_imagery',
        address_used: address,
        error_message: `Street View metadata: ${meta.status}`,
      };
    }

    const url = new URL('https://maps.googleapis.com/maps/api/streetview');
    url.searchParams.set('size', '640x640');
    url.searchParams.set('location', address);
    url.searchParams.set('fov', '90');
    url.searchParams.set('pitch', '0');
    url.searchParams.set('key', apiKey);

    const res = await fetch(url.toString());
    if (!res.ok) {
      return {
        status: 'error',
        address_used: address,
        error_message: `Street View image HTTP ${res.status}`,
      };
    }

    const contentType = res.headers.get('content-type') ?? '';
    if (!contentType.includes('image')) {
      return {
        status: 'error',
        address_used: address,
        error_message: 'Street View did not return an image',
      };
    }

    const arrayBuffer = await res.arrayBuffer();
    return {
      status: 'ok',
      address_used: address,
      image_bytes: Buffer.from(arrayBuffer),
    };
  } catch (error) {
    return {
      status: 'error',
      address_used: address,
      error_message: error instanceof Error ? error.message : 'Street View fetch failed',
    };
  }
}

export function streetViewImageDataUrl(bytes: Buffer): string {
  return `data:image/jpeg;base64,${bytes.toString('base64')}`;
}