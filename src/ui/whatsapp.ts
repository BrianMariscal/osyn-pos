export function openWhatsapp(phone: string, message: string): void {
  const clean = phone.replace(/\D/g, "");
  window.open(`https://wa.me/${clean}?text=${encodeURIComponent(message)}`, "_blank");
}
