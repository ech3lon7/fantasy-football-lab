import { importWorkbook } from "../import/workbook";
self.onmessage = async (e: MessageEvent<{ id: string; bytes: Uint8Array }>) => {
  try {
    self.postMessage({
      id: e.data.id,
      result: await importWorkbook(e.data.bytes),
    });
  } catch (error) {
    self.postMessage({
      id: e.data.id,
      error: error instanceof Error ? error.message : "Import failed",
    });
  }
};
