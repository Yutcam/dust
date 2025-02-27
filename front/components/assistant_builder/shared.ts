import { ConnectorProvider } from "@app/lib/connectors_api";
import { TimeframeUnit } from "@app/types/assistant/actions/retrieval";

export const TIME_FRAME_MODES = ["AUTO", "CUSTOM", "ALL_TIME"] as const;
export type TimeFrameMode = (typeof TIME_FRAME_MODES)[number];
export const TIME_FRAME_MODE_TO_LABEL: Record<TimeFrameMode, string> = {
  AUTO: "Auto (default)",
  CUSTOM: "Custom",
  ALL_TIME: "All time",
};
export const TIME_FRAME_UNIT_TO_LABEL: Record<TimeframeUnit, string> = {
  hour: "hours",
  day: "days",
  week: "weeks",
  month: "months",
  year: "years",
};

export const CONNECTOR_PROVIDER_TO_RESOURCE_NAME: Record<
  ConnectorProvider,
  {
    singular: string;
    plural: string;
  }
> = {
  notion: { singular: "page", plural: "pages" },
  google_drive: { singular: "folder", plural: "folders" },
  slack: { singular: "channel", plural: "channels" },
  github: { singular: "repository", plural: "repositories" },
};

export const DROID_AVATARS_BASE_PATH = "/static/droidavatar/";

export const DROID_AVATAR_FILES = [
  "Droid_Yellow_8.jpg",
  "Droid_Yellow_7.jpg",
  "Droid_Yellow_6.jpg",
  "Droid_Yellow_5.jpg",
  "Droid_Yellow_4.jpg",
  "Droid_Yellow_3.jpg",
  "Droid_Yellow_2.jpg",
  "Droid_Yellow_1.jpg",
  "Droid_Teal_8.jpg",
  "Droid_Teal_7.jpg",
  "Droid_Teal_6.jpg",
  "Droid_Teal_5.jpg",
  "Droid_Teal_4.jpg",
  "Droid_Teal_3.jpg",
  "Droid_Teal_2.jpg",
  "Droid_Teal_1.jpg",
  "Droid_Sky_8.jpg",
  "Droid_Sky_7.jpg",
  "Droid_Sky_6.jpg",
  "Droid_Sky_5.jpg",
  "Droid_Sky_4.jpg",
  "Droid_Sky_3.jpg",
  "Droid_Sky_2.jpg",
  "Droid_Sky_1.jpg",
  "Droid_Red_8.jpg",
  "Droid_Red_7.jpg",
  "Droid_Red_6.jpg",
  "Droid_Red_5.jpg",
  "Droid_Red_4.jpg",
  "Droid_Red_3.jpg",
  "Droid_Red_2.jpg",
  "Droid_Red_1.jpg",
  "Droid_Purple_8.jpg",
  "Droid_Purple_7.jpg",
  "Droid_Purple_6.jpg",
  "Droid_Purple_5.jpg",
  "Droid_Purple_4.jpg",
  "Droid_Purple_3.jpg",
  "Droid_Purple_2.jpg",
  "Droid_Purple_1.jpg",
  "Droid_Pink_8.jpg",
  "Droid_Pink_7.jpg",
  "Droid_Pink_6.jpg",
  "Droid_Pink_5.jpg",
  "Droid_Pink_4.jpg",
  "Droid_Pink_3.jpg",
  "Droid_Pink_2.jpg",
  "Droid_Pink_1.jpg",
  "Droid_Orange_8.jpg",
  "Droid_Orange_7.jpg",
  "Droid_Orange_6.jpg",
  "Droid_Orange_5.jpg",
  "Droid_Orange_4.jpg",
  "Droid_Orange_3.jpg",
  "Droid_Orange_2.jpg",
  "Droid_Orange_1.jpg",
  "Droid_Lime_8.jpg",
  "Droid_Lime_7.jpg",
  "Droid_Lime_6.jpg",
  "Droid_Lime_5.jpg",
  "Droid_Lime_4.jpg",
  "Droid_Lime_3.jpg",
  "Droid_Lime_2.jpg",
  "Droid_Lime_1.jpg",
  "Droid_Indigo_8.jpg",
  "Droid_Indigo_7.jpg",
  "Droid_Indigo_6.jpg",
  "Droid_Indigo_5.jpg",
  "Droid_Indigo_4.jpg",
  "Droid_Indigo_3.jpg",
  "Droid_Indigo_2.jpg",
  "Droid_Indigo_1.jpg",
  "Droid_Green_8.jpg",
  "Droid_Green_7.jpg",
  "Droid_Green_6.jpg",
  "Droid_Green_5.jpg",
  "Droid_Green_4.jpg",
  "Droid_Green_3.jpg",
  "Droid_Green_2.jpg",
  "Droid_Green_1.jpg",
  "Droid_Cream_8.jpg",
  "Droid_Cream_7.jpg",
  "Droid_Cream_6.jpg",
  "Droid_Cream_5.jpg",
  "Droid_Cream_4.jpg",
  "Droid_Cream_3.jpg",
  "Droid_Cream_2.jpg",
  "Droid_Cream_1.jpg",
  "Droid_Black_8.jpg",
  "Droid_Black_7.jpg",
  "Droid_Black_6.jpg",
  "Droid_Black_5.jpg",
  "Droid_Black_4.jpg",
  "Droid_Black_3.jpg",
  "Droid_Black_2.jpg",
  "Droid_Black_1.jpg",
];
