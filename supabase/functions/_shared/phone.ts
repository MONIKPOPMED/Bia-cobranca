/**
 * Stored phone formats for a WhatsApp JID's digits: with/without "+", and —
 * for Brazilian mobiles — with/without the 9th digit, since WhatsApp JIDs for
 * older BR numbers omit it (554891667070) while debtors are imported with it
 * (+5548991667070).
 */
export function phoneVariants(jidDigits: string): string[] {
  const digits = jidDigits.replace(/\D/g, "");
  if (digits.length < 10) return [];
  const bases = new Set<string>([digits]);
  if (digits.startsWith("55")) {
    const ddd = digits.slice(2, 4);
    const rest = digits.slice(4);
    if (rest.length === 8) bases.add(`55${ddd}9${rest}`);
    if (rest.length === 9 && rest.startsWith("9")) bases.add(`55${ddd}${rest.slice(1)}`);
  }
  return [...bases].flatMap((b) => [b, `+${b}`]);
}
