import { atom } from "jotai";
import { atomWithStorage } from "jotai/utils";

export interface UserRoute {
  id: string;
  name: string;
  waySections: {
    wayId: string;
    startNodeId: string;
    endNodeId: string;
  }[];
  color: string;
  bullet: string;
  createdAt: number;
}

// Store for user-designed routes
export const userRoutesAtom = atomWithStorage<UserRoute[]>("user-routes", []);

// Current route being designed
export const currentRouteAtom = atom<UserRoute | null>(null);

// Current stage of route design
export const routeDesignStageAtom = atom<
  "select-initial" | "select-direction" | "build-route"
>("select-initial");

// Currently selected way during route design
export const selectedWayAtom = atom<string | null>(null);

// Direction selection for bidirectional ways
export const directionSelectionAtom = atom<"forward" | "backward" | null>(null);

// Available ways for the next selection (connected to the current route)
export const availableWaysAtom = atom<string[]>([]);
