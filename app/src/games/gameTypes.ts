import type { TttMsg } from "./ttt";
import type { RpsMsg, MatchFormat } from "./rps";
import type { DabMsg } from "./dab";
import type { ScribbleMsg } from "./scribble";

export type GameMsg = {
  game: "ttt" | "rps" | "dab" | "scribble";
  payload: TttMsg | RpsMsg | DabMsg | ScribbleMsg;
};

export type GameSendFn = (peerId: string, msg: GameMsg) => Promise<void>;

export type GameDispatchFn = (fromId: string, msg: GameMsg) => void;

export type PendingGameInvite = {
  game: "ttt" | "rps" | "dab" | "scribble";
  matchId: string;
  fromId: string;
  fromName: string;
  format?: MatchFormat;
  rows?: number;
  cols?: number;
  openOnly?: boolean;
};

export type GameReplayFn = (peerId: string, matchId: string) => Promise<GameMsg[]>;
