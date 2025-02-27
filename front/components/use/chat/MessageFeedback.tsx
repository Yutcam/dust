import {
  HandThumbDownIcon,
  HandThumbUpIcon,
  IconToggleButton,
} from "@dust-tt/sparkle";

import { classNames } from "@app/lib/utils";
import { ChatMessageType, MessageFeedbackStatus } from "@app/types/chat";

export type FeedbackHandler = (
  message: ChatMessageType,
  status: MessageFeedbackStatus
) => void;

export function MessageFeedback({
  message,
  feedbackHandler,
  hover, // should the feedback be always visible or only on hover?
}: {
  message: ChatMessageType;
  feedbackHandler: FeedbackHandler;
  hover: boolean;
}) {
  return (
    <div
      className={classNames(
        "flex-end flex flex-row-reverse gap-1 pl-1 pt-2 text-gray-400",
        !message.feedback && hover ? "invisible group-hover:visible" : ""
      )}
    >
      <IconToggleButton
        variant="tertiary"
        icon={HandThumbUpIcon}
        onClick={() => feedbackHandler(message, "positive")}
        className="ml-1"
        selected={message.feedback === "positive"}
      />
      <IconToggleButton
        variant="tertiary"
        icon={HandThumbDownIcon}
        onClick={() => feedbackHandler(message, "negative")}
        className="ml-1"
        selected={message.feedback === "negative"}
      />
    </div>
  );
}
