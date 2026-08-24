/** navigator.clipboard is undefined over plain HTTP on a LAN host, which is
 *  exactly how this gets used — fall back to the old selection trick. */
export async function copyText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    try {
      return await navigator.clipboard.writeText(text);
    } catch {
      /* fall through */
    }
  }
  const box = document.createElement("textarea");
  box.value = text;
  box.style.position = "fixed";
  box.style.opacity = "0";
  document.body.append(box);
  box.select();
  document.execCommand("copy");
  box.remove();
}