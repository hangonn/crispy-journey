import { parsePageMessage, PageMessage } from "./types";
import { handleTrackerMessage } from "../tracking/trackerManager";

/**
 * Route one raw message from a page.
 *
 * Protocol messages are returned to the caller. Messages that carry a `command` (the web
 * tracker, and the pages' other scripts) are handed to the tracker SDK, which ignores
 * anything that is not one of its commands. Everything else is ignored.
 */
export function handleWebViewMessage(rawMessage: string): PageMessage | null {
  const pageMessage = parsePageMessage(rawMessage);
  if (pageMessage) return pageMessage;

  try {
    const parsed = JSON.parse(rawMessage);
    if (parsed && typeof parsed === "object" && "command" in parsed) {
      handleTrackerMessage(rawMessage);
    }
  } catch {
    // Not JSON, ignore
  }

  return null;
}
