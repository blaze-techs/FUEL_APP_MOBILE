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

// The legacy build has the exact same shape as the modern build.
declare module "pdfjs-dist/legacy/build/pdf.mjs" {
  export * from "pdfjs-dist";
  export const GlobalWorkerOptions: { workerSrc: string };
  export function getDocument(source: { data: ArrayBuffer | Uint8Array }): {
    promise: Promise<{
      numPages: number;
      getPage(pageNum: number): Promise<{
        getTextContent(): Promise<any>;
        getViewport(params: { scale: number }): any;
        render(params: {
          canvasContext: CanvasRenderingContext2D;
          viewport: any;
        }): { promise: Promise<void> };
      }>;
    }>;
  };
}

declare module "pdfjs-dist/legacy/build/pdf.worker.min.mjs?url" {
  const workerUrl: string;
  export default workerUrl;
}
