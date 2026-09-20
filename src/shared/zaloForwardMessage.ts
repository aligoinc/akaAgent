/** Text shared by mforward. Keep in sync with akaAgent/Chat API. */
export type ZaloForwardText = string | {
  msg: string;
  styles?: ReadonlyArray<{ start?: unknown; len?: unknown; st?: unknown; indentSize?: unknown }> | undefined;
};

/** mforward reads nested rtfProps, unlike sendMessage's textProperties. */
export function buildZaloForwardMessageInfo(input: ZaloForwardText): { message: string; rtfProps?: string } {
  const raw = typeof input === "string" ? input : input.msg;
  const message = raw.trim();
  const offset = raw.length - raw.trimStart().length;
  const styles = (typeof input === "string" ? [] : input.styles ?? []).flatMap((style) => {
    if (typeof style.start !== "number" || !Number.isInteger(style.start) || style.start < 0 ||
        typeof style.len !== "number" || !Number.isInteger(style.len) || style.len <= 0 ||
        typeof style.st !== "string" || !style.st) return [];
    const start = Math.max(0, style.start - offset);
    const end = Math.min(message.length, style.start + style.len - offset);
    if (end <= start) return [];
    const { indentSize, ...rest } = style;
    const indent = typeof indentSize === "number" && Number.isInteger(indentSize) && indentSize > 0
      ? indentSize : 1;
    return [{ ...rest, start, len: end - start, st: style.st === "ind_$" ? `ind_${indent}0` : style.st }];
  });
  return { message, ...(styles.length ? { rtfProps: JSON.stringify({ styles, ver: 0 }) } : {}) };
}
