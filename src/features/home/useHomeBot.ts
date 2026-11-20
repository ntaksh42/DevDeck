import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  commandErrorMessage,
  dismissHomeSuggestion,
  getHomeBot,
  getHomeChat,
  homeBotKey,
  homeChatKey,
  markHomeSeen,
  newHomeChat,
  runHomeLookNow,
  sendHomeMessage,
  stopHomeWorker,
  type SendHomeMessageInput,
} from "@/lib/azdoCommands";
import { subscribeTauriEvent } from "@/lib/tauriEvents";
import { pushNotice, pushToast } from "@/lib/toast";

/** Busy states refetch quickly (the browser demo has no events); idle ones rarely. */
const BUSY_MS = 1_500;
const IDLE_MS = 60_000;

/** The Home view's data, kept current by `home:updated`. */
export function useHomeBot() {
  const queryClient = useQueryClient();
  const bot = useQuery({
    queryKey: homeBotKey,
    queryFn: getHomeBot,
    refetchInterval: (query) => (query.state.data?.look.running ? BUSY_MS : IDLE_MS),
  });
  const chat = useQuery({
    queryKey: homeChatKey,
    queryFn: getHomeChat,
    refetchInterval: (query) => (query.state.data && query.state.data.state !== "idle" ? BUSY_MS : IDLE_MS),
  });

  useEffect(
    () =>
      subscribeTauriEvent("home:updated", () => {
        void queryClient.invalidateQueries({ queryKey: homeBotKey });
        void queryClient.invalidateQueries({ queryKey: homeChatKey });
      }),
    [queryClient],
  );
  // Results the sync just changed (an Inbox reply, a vote) change what the bot would say.
  useEffect(
    () => subscribeTauriEvent("sync:updated", () => void queryClient.invalidateQueries({ queryKey: homeBotKey })),
    [queryClient],
  );

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: homeBotKey });
    void queryClient.invalidateQueries({ queryKey: homeChatKey });
  };
  const onError = (error: unknown) => pushToast(commandErrorMessage(error));

  const lookNow = useMutation({
    mutationFn: runHomeLookNow,
    onSuccess: refresh,
    onError: (error) => pushNotice(commandErrorMessage(error)),
  });
  const dismiss = useMutation({
    mutationFn: dismissHomeSuggestion,
    onSuccess: () => {
      pushNotice("Dismissed. It won't be suggested again for 30 days.");
      refresh();
    },
    onError,
  });
  const send = useMutation({
    mutationFn: (input: SendHomeMessageInput) => sendHomeMessage(input),
    onSuccess: refresh,
    onError,
  });
  const stop = useMutation({ mutationFn: stopHomeWorker, onSuccess: refresh, onError });
  const newChat = useMutation({ mutationFn: newHomeChat, onSuccess: refresh, onError });
  const seen = useMutation({ mutationFn: markHomeSeen, onSuccess: refresh });

  return { bot, chat, lookNow, dismiss, send, stop, newChat, seen };
}

/** Unread suggestions for the sidebar badge, without arming the schedule. */
export function useHomeNewCount(enabled: boolean): number | null {
  const query = useQuery({ queryKey: homeBotKey, queryFn: getHomeBot, enabled, refetchInterval: IDLE_MS });
  const count = query.data?.newCount ?? 0;
  return count > 0 ? count : null;
}
