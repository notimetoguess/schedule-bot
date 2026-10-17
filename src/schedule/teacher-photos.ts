const DIRECTORY_URL = "https://rating2.lntu.edu.ua/uk/searchuser";

/** Public directory lookup, deliberately best-effort: schedules must work without it. */
export class TeacherPhotos {
  private photos = new Map<string, Map<string, string>>();
  private readonly surnameLookups = new Map<string, number>();
  private readonly surnameLoads = new Map<string, Promise<void>>();
  private readonly imageCache = new Map<string, Buffer>();
  constructor(private readonly fetcher: typeof fetch = fetch) {}

  async find(name: string | undefined): Promise<Buffer | undefined> {
    if (!name) return undefined;
    const surname = surnameOf(name);
    await this.loadSurname(surname);
    const requested = nameParts(name);
    const matches = [...(this.photos.get(surname) ?? [])].filter(([candidate]) => {
      const parts = candidate.split(" ");
      return requested.every((part, index) =>
        part.length === 1 ? parts[index]?.startsWith(part) : parts[index] === part);
    });
    const url = matches.length === 1 ? matches[0]![1] : undefined;
    if (!url) return undefined;
    const cached = this.imageCache.get(url);
    if (cached) return cached;
    try {
      const response = await this.fetcher(url, { signal: AbortSignal.timeout(5000) });
      const bytes = Buffer.from(await response.arrayBuffer());
      if (!response.ok || bytes.length === 0 || bytes.length > 2_000_000) return undefined;
      this.imageCache.set(url, bytes);
      return bytes;
    } catch { return undefined; }
  }

  private async loadSurname(surname: string): Promise<void> {
    const previous = this.surnameLookups.get(surname) ?? 0;
    if (Date.now() - previous < 24 * 60 * 60 * 1000) return;
    const active = this.surnameLoads.get(surname);
    if (active) return active;
    const loading = this.fetchSurname(surname).finally(() => {
      this.surnameLookups.set(surname, Date.now());
      this.surnameLoads.delete(surname);
    });
    this.surnameLoads.set(surname, loading);
    return loading;
  }

  private async fetchSurname(surname: string): Promise<void> {
    try {
      const searchUrl = new URL(DIRECTORY_URL);
      searchUrl.searchParams.set("field_prizvische_value", surname);
      const response = await this.fetcher(searchUrl, { signal: AbortSignal.timeout(8000) });
      const html = await response.text();
      if (!response.ok) return;
      const photos = new Map<string, string>();
      // Filter by surname first, then retain exact full/initial forms for disambiguation.
      const pattern = /<img[^>]+src=["']([^"']+)["'][^>]*>\s*<\/div>\s*<a[^>]*>([^<]{4,160})<p/gi;
      for (const match of html.matchAll(pattern)) {
        const name = nameParts(match[2]!).join(" ");
        if (name.split(" ").length >= 2 && surnameOf(name) === surname) {
          const imageUrl = new URL(match[1]!, DIRECTORY_URL).toString();
          photos.set(name, imageUrl);
        }
      }
      this.photos.set(surname, photos);
    } catch { /* Use initials avatar when the directory is unavailable. */ }
  }
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/[.'’]/g, "").replace(/\s+/g, " ").trim();
}

function nameParts(value: string): string[] {
  return normalize(value
    .replace(/\s+(Доцент|Професор|Асистент|Викладач)(?=\s|$|[.,]).*$/iu, "")
    .replace(/\./g, " ")).split(" ");
}

function surnameOf(value: string): string { return normalize(value).split(" ")[0] ?? normalize(value); }

export function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]!.toUpperCase()).join("") || "?";
}
