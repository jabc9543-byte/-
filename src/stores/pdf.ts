import { create } from "zustand";
import { api, type PdfAsset, type PdfAnnotation } from "../api";

interface PdfState {
  list: PdfAsset[];
  activeId: string | null;
  annotations: PdfAnnotation[];
  refresh: () => Promise<void>;
  open: (id: string | null) => Promise<void>;
  importFile: (path: string) => Promise<PdfAsset>;
  remove: (id: string) => Promise<void>;
  loadAnnotations: (id: string) => Promise<void>;
  addAnnotation: (a: PdfAnnotation) => Promise<void>;
  updateAnnotation: (id: string, patch: Partial<PdfAnnotation>) => Promise<void>;
  removeAnnotation: (id: string) => Promise<void>;
  importZotero: (content: string) => Promise<{ pages_created: number; entries_seen: number }>;
}

async function persist(pdfId: string, annotations: PdfAnnotation[]) {
  await api.savePdfAnnotations(pdfId, annotations);
}

export const usePdfStore = create<PdfState>((set, get) => ({
  list: [],
  activeId: null,
  annotations: [],

  refresh: async () => {
    const list = await api.listPdfs();
    set({ list });
  },

  open: async (id) => {
    set({ activeId: id, annotations: [] });
    if (id) await get().loadAnnotations(id);
  },

  importFile: async (path) => {
    const asset = await api.importPdf(path);
    await get().refresh();
    return asset;
  },

  remove: async (id) => {
    await api.deletePdf(id);
    if (get().activeId === id) set({ activeId: null, annotations: [] });
    await get().refresh();
  },

  loadAnnotations: async (id) => {
    const annotations = await api.listPdfAnnotations(id);
    set({ annotations });
  },

  addAnnotation: async (a) => {
    const id = get().activeId;
    if (!id) return;
    const next = [...get().annotations, a];
    set({ annotations: next });
    await persist(id, next);
  },

  updateAnnotation: async (aid, patch) => {
    const id = get().activeId;
    if (!id) return;
    const next = get().annotations.map((a) => (a.id === aid ? { ...a, ...patch } : a));
    set({ annotations: next });
    await persist(id, next);
  },

  removeAnnotation: async (aid) => {
    const id = get().activeId;
    if (!id) return;
    const next = get().annotations.filter((a) => a.id !== aid);
    set({ annotations: next });
    await persist(id, next);
  },

  importZotero: async (content) => {
    return api.importZoteroBibtex(content);
  },
}));
