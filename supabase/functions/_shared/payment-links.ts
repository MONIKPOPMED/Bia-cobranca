// Fixed POPMED payment links — valid for ONE monthly installment only.
// There is no link yet for 2+ overdue installments (those go to the team).
export const PAYMENT_LINKS = {
  pix: "https://popmed.com.br/produto/popmed-plano-mensal-ia2-pix/",
  cartao: "https://popmed.com.br/produto/popmed-plano-mensal-ia2-cc/",
} as const;

export type PaymentMethod = keyof typeof PAYMENT_LINKS;

/** POPMED rule: 1–2 overdue installments pay full; 3 or more get 10% off. */
export function discountPctFor(overdueCount: number): number {
  return overdueCount >= 3 ? 10 : 0;
}
