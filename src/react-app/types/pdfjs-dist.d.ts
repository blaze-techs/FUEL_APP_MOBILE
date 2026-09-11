declare module "pdfjs-dist" {
  const pdfjsLib: any;
  export = pdfjsLib;
  export const GlobalWorkerOptions: { workerSrc: string };
  export const version: string;
  export function getDocument(
    source: { data: ArrayBuffer } | string | { url: string },
  ): { promise: Promise<PDFDocumentProxy> };

  interface PDFDocumentProxy {
    numPages: number;
    getPage(pageNum: number): Promise<PDFPageProxy>;
    destroy(): void;
  }

  interface PDFPageProxy {
    getTextContent(): Promise<{ items: TextItem[] }>;
    getViewport(params: { scale: number }): any;
    render(params: {
      canvasContext: CanvasRenderingContext2D;
      viewport: any;
    }): { promise: Promise<void> };
  }

  interface TextItem {
    str: string;
    dir: string;
    width: number;
    height: number;
    transform: number[];
    fontName: string;
    hasEOL: boolean;
  }
}
