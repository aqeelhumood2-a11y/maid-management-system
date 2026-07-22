"use client";

/**
 * Renders a DOM node to a (possibly multi-page) PDF via a screenshot —
 * html2canvas rasterizes exactly what the browser already renders, so
 * Arabic text comes out correctly shaped and RTL without needing to embed
 * or shape an Arabic font inside the PDF itself (jsPDF's own text layer has
 * no Arabic shaping support). Both libraries are dynamically imported so
 * they never end up in the initial client bundle — only pulled in when a
 * manager actually clicks an export button.
 */
export async function exportElementToPdf(element: HTMLElement, filename: string): Promise<void> {
  const [{ default: html2canvas }, { jsPDF }] = await Promise.all([import("html2canvas"), import("jspdf")]);

  const canvas = await html2canvas(element, { scale: 2, backgroundColor: "#ffffff" });
  const imgData = canvas.toDataURL("image/png");

  const pdf = new jsPDF({ orientation: "portrait", unit: "pt", format: "a4" });
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const imgWidth = pageWidth;
  const imgHeight = (canvas.height * imgWidth) / canvas.width;

  let heightLeft = imgHeight;
  let position = 0;
  pdf.addImage(imgData, "PNG", 0, position, imgWidth, imgHeight);
  heightLeft -= pageHeight;

  while (heightLeft > 0) {
    position -= pageHeight;
    pdf.addPage();
    pdf.addImage(imgData, "PNG", 0, position, imgWidth, imgHeight);
    heightLeft -= pageHeight;
  }

  pdf.save(filename);
}
