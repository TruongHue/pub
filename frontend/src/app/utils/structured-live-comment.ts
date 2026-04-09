/**
 * Parse live comments — ưu tiên định dạng gọn, một dòng:
 *   <họ tên> <ngày sinh> <câu hỏi>
 * Ngày sinh nhận dạng: 15/08/1999, 2001-03-22, … (dùng `normalizeVietnameseBirthDate`).
 * Phần trước ngày đầu tiên = họ tên, phần sau = câu hỏi.
 *
 * Giữ fallback parser cũ (Họ tên: / Ngày sinh: / Câu hỏi:) cho dữ liệu lịch sử.
 *
 * Khuyến nghị thêm `@` ở đầu (TikTok hay lọc/ẩn bình luận) — parser sẽ bỏ `@` đầu dòng.
 */

export interface StructuredLiveFields {
  name: string;
  birthDate: string;
  question: string;
  /** YYYY-MM-DD for HTML date inputs; null if parsing could not normalize */
  birthDateInput: string | null;
}

function stripVietnameseTones(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function mapLabelToField(labelRaw: string): 'name' | 'birthDate' | 'question' | null {
  const n = stripVietnameseTones(labelRaw.replace(/^["']|["']$/g, '').trim());
  if (n === 'ho ten') return 'name';
  if (n.includes('ngay sinh')) return 'birthDate';
  if (n.includes('cau hoi')) return 'question';
  return null;
}

function pad2(n: string): string {
  return n.length === 1 ? `0${n}` : n;
}

/** Best-effort → YYYY-MM-DD for <input type="date"> */
export function normalizeVietnameseBirthDate(raw: string): string | null {
  const t = raw.trim().replace(/\s+/g, '');
  if (!t) return null;

  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;

  const dmy = t.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
  if (dmy) {
    const day = pad2(dmy[1]);
    const month = pad2(dmy[2]);
    const year = dmy[3];
    const candidate = `${year}-${month}-${day}`;
    const d = new Date(`${candidate}T12:00:00`);
    if (!Number.isNaN(d.getTime())) return candidate;
  }

  const ymd = t.match(/^(\d{4})[/.-](\d{1,2})[/.-](\d{1,2})$/);
  if (ymd) {
    const year = ymd[1];
    const month = pad2(ymd[2]);
    const day = pad2(ymd[3]);
    const candidate = `${year}-${month}-${day}`;
    const d = new Date(`${candidate}T12:00:00`);
    if (!Number.isNaN(d.getTime())) return candidate;
  }

  return null;
}

/** Bỏ @ đầu dòng (TikTok / live) trước khi parse. */
function stripLeadingAtPrefix(raw: string): string {
  return raw.trim().replace(/^@+\s*/, '');
}

function completeFields(partial: Partial<Record<'name' | 'birthDate' | 'question', string>>): StructuredLiveFields | null {
  const name = partial.name?.trim();
  const birthDate = partial.birthDate?.trim();
  const question = partial.question?.trim();
  if (!name || !birthDate || !question) return null;
  if (name.length < 2 || question.length < 4) return null;

  const birthDateInput = normalizeVietnameseBirthDate(birthDate);
  return {
    name,
    birthDate,
    question,
    birthDateInput
  };
}

/** Tìm chuỗi ngày đầu tiên trong text mà normalize được thành YYYY-MM-DD. */
function findFirstParsableBirthSpan(raw: string): { index: number; length: number; raw: string } | null {
  const patterns = [/\d{4}[/.-]\d{1,2}[/.-]\d{1,2}/g, /\d{1,2}[/.-]\d{1,2}[/.-]\d{4}/g];
  const hits: { index: number; length: number; raw: string }[] = [];
  for (const re of patterns) {
    const copy = new RegExp(re.source, 'g');
    let m: RegExpExecArray | null;
    while ((m = copy.exec(raw)) !== null) {
      const candidate = m[0];
      if (normalizeVietnameseBirthDate(candidate)) {
        hits.push({ index: m.index, length: candidate.length, raw: candidate });
      }
    }
  }
  if (!hits.length) return null;
  hits.sort((a, b) => a.index - b.index);
  return hits[0];
}

/** Một dòng: họ tên · ngày sinh · câu hỏi (không cần nhãn). */
function parseCompactLine(raw: string): StructuredLiveFields | null {
  const text = raw.trim();
  if (!text) return null;
  const hit = findFirstParsableBirthSpan(text);
  if (!hit) return null;
  const name = text.slice(0, hit.index).trim();
  const birthDate = hit.raw.trim();
  const question = text.slice(hit.index + hit.length).trim();
  return completeFields({ name, birthDate, question });
}

function parseLineBased(raw: string): StructuredLiveFields | null {
  const partial: Partial<Record<'name' | 'birthDate' | 'question', string>> = {};
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const m = trimmed.match(/^["']?(.+?)["']?\s*[:：]\s*(.+)$/u);
    if (!m) continue;
    const field = mapLabelToField(stripVietnameseTones(m[1]));
    if (!field) continue;
    partial[field] = m[2].trim().replace(/^["']|["']$/g, '');
  }
  return completeFields(partial);
}

/** Single line: Họ tên: A, Ngày sinh: 1/1/2000, Câu hỏi: ... */
function parseInline(raw: string): StructuredLiveFields | null {
  const text = raw.replace(/\r?\n/g, ' ').trim();
  const re =
    /(H[ọo]\s*t[êe]n|Họ\s*tên|Ho\s*ten|N[găạ]y\s*sinh|Ngày\s*sinh|Ngay\s*sinh|C[âa]u\s*h[ỏo]i|Câu\s*hỏi|Cau\s*hoi)\s*[:：]/giu;
  const hits: { index: number; end: number; field: 'name' | 'birthDate' | 'question' }[] = [];
  let m: RegExpExecArray | null;
  const copy = new RegExp(re.source, re.flags);
  while ((m = copy.exec(text)) !== null) {
    const field = mapLabelToField(m[1]);
    if (field) hits.push({ index: m.index, end: m.index + m[0].length, field });
  }
  if (hits.length < 3) return null;

  hits.sort((a, b) => a.index - b.index);

  const partial: Partial<Record<'name' | 'birthDate' | 'question', string>> = {};
  for (let i = 0; i < hits.length; i += 1) {
    const start = hits[i].end;
    const end = i + 1 < hits.length ? hits[i + 1].index : text.length;
    let value = text.slice(start, end).trim();
    value = value.replace(/^[,.;\s]+|[,.;\s]+$/g, '').replace(/^["']|["']$/g, '');
    partial[hits[i].field] = value;
  }
  return completeFields(partial);
}

export function parseStructuredLiveComment(raw: string): StructuredLiveFields | null {
  if (!raw?.trim()) return null;
  const trimmed = stripLeadingAtPrefix(raw);
  if (!trimmed) return null;
  return parseCompactLine(trimmed) ?? parseLineBased(trimmed) ?? parseInline(trimmed);
}

/** Chuẩn hóa câu hỏi để so sánh trùng (spam / lặp). */
export function normalizeQuestionForDedupe(raw: string): string {
  return stripVietnameseTones(raw.trim())
    .replace(/\s+/g, ' ')
    .replace(/[!?.。,:;]+$/gu, '')
    .trim();
}

/** Lọc viewer đủ dữ liệu và câu hỏi có vẻ là tư vấn thật (tránh spam / câu quá sơ sài). */
export function isReasonableOracleQuestion(parsed: StructuredLiveFields): boolean {
  const q = parsed.question.trim();
  if (q.length < 12 || q.length > 600) return false;
  if (!parsed.birthDateInput) return false;

  const letters = q.replace(/[\s\d.,;:!?'"()\[\]{}*/\\+=\-_]+/g, '');
  if (letters.length < 8) return false;

  if (/(.)\1{7,}/u.test(q)) return false;
  if (/^[\d\s./:-]+$/.test(q)) return false;

  const words = q.split(/\s+/).filter((w) => w.length > 0);
  if (words.length < 3) return false;

  return true;
}
