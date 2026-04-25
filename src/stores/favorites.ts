import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { PageId } from "../types";

const RECENT_LIMIT = 15;

interface FavoritesState {
  /** 收藏的页面 id 列表（按加入顺序）。 */
  favorites: PageId[];
  /** 最近打开的页面 id 列表（最近的在前）。 */
  recents: PageId[];

  toggleFavorite: (id: PageId) => void;
  isFavorite: (id: PageId) => boolean;
  pushRecent: (id: PageId) => void;
  forgetPage: (id: PageId) => void;
  clearRecents: () => void;
}

export const useFavoritesStore = create<FavoritesState>()(
  persist(
    (set, get) => ({
      favorites: [],
      recents: [],

      toggleFavorite: (id) => {
        const list = get().favorites;
        set({
          favorites: list.includes(id)
            ? list.filter((x) => x !== id)
            : [...list, id],
        });
      },

      isFavorite: (id) => get().favorites.includes(id),

      pushRecent: (id) => {
        const list = get().recents.filter((x) => x !== id);
        list.unshift(id);
        if (list.length > RECENT_LIMIT) list.length = RECENT_LIMIT;
        set({ recents: list });
      },

      forgetPage: (id) => {
        set({
          favorites: get().favorites.filter((x) => x !== id),
          recents: get().recents.filter((x) => x !== id),
        });
      },

      clearRecents: () => set({ recents: [] }),
    }),
    {
      name: "logseq-rs:favorites",
      version: 1,
    },
  ),
);
