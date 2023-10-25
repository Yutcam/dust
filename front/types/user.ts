import { RoleType } from "@app/lib/auth";
import { ModelId } from "@app/lib/databases";

/**
 *  Expresses limits for usage of the product
 * Any positive number enforces the limit, -1 means no limit.
 * */

export type ManageDataSourcesLimitsType = {
  isSlackAllowed: boolean;
  isNotionAllowed: boolean;
  isGoogleDriveAllowed: boolean;
  isGithubAllowed: boolean;
};
export type LimitsType = {
  assistant: {
    isSlackBotAllowed: boolean;
    maxMessages: number;
  };
  connections: ManageDataSourcesLimitsType;
  dataSources: {
    count: number;
    documents: {
      count: number;
      sizeMb: number;
    };
  };
  users: {
    maxUsers: number;
  };
  largeModels: boolean; // TODO: remove this, it is always true now (kept to limit the scope of the PR)
};

export type PlanType = {
  code: string;
  name: string;
  status: "active" | "ended";
  startDate: number | null;
  endDate: number | null;
  limits: LimitsType;
};

export type WorkspaceType = {
  id: ModelId;
  sId: string;
  name: string;
  allowedDomain: string | null;
  role: RoleType;
  upgradedAt: number | null;
};

export type UserProviderType = "github" | "google";

export type UserType = {
  id: ModelId;
  provider: UserProviderType;
  providerId: string;
  username: string;
  email: string;
  name: string;
  image: string | null;
  workspaces: WorkspaceType[];
  isDustSuperUser: boolean;
};

export type UserMetadataType = {
  key: string;
  value: string;
};
