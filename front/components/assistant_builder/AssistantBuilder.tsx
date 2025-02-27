import {
  Avatar,
  Button,
  ChevronDownIcon,
  ChevronUpIcon,
  DropdownMenu,
  Icon,
  Input,
  Modal,
  PencilSquareIcon,
  TrashIcon,
} from "@dust-tt/sparkle";
import { Transition } from "@headlessui/react";
import * as t from "io-ts";
import router from "next/router";
import { useCallback, useEffect, useState } from "react";
import ReactTextareaAutosize from "react-textarea-autosize";

import AssistantBuilderDataSourceModal from "@app/components/assistant_builder/AssistantBuilderDataSourceModal";
import DataSourceSelectionSection from "@app/components/assistant_builder/DataSourceSelectionSection";
import {
  DROID_AVATAR_FILES,
  DROID_AVATARS_BASE_PATH,
  TimeFrameMode,
} from "@app/components/assistant_builder/shared";
import AppLayout from "@app/components/sparkle/AppLayout";
import {
  AppLayoutSimpleCloseTitle,
  AppLayoutSimpleSaveCancelTitle,
} from "@app/components/sparkle/AppLayoutTitle";
import { subNavigationAdmin } from "@app/components/sparkle/navigation";
import {
  CLAUDE_DEFAULT_MODEL_CONFIG,
  CLAUDE_INSTANT_DEFAULT_MODEL_CONFIG,
  getSupportedModelConfig,
  GPT_3_5_TURBO_DEFAULT_MODEL_CONFIG,
  GPT_4_DEFAULT_MODEL_CONFIG,
  SupportedModel,
} from "@app/lib/assistant";
import { ConnectorProvider } from "@app/lib/connectors_api";
import { useAgentConfigurations } from "@app/lib/swr";
import { classNames } from "@app/lib/utils";
import { PostOrPatchAgentConfigurationRequestBodySchema } from "@app/pages/api/w/[wId]/assistant/agent_configurations";
import { TimeframeUnit } from "@app/types/assistant/actions/retrieval";
import { DataSourceType } from "@app/types/data_source";
import { UserType, WorkspaceType } from "@app/types/user";

const usedModelConfigs = [
  GPT_4_DEFAULT_MODEL_CONFIG,
  GPT_3_5_TURBO_DEFAULT_MODEL_CONFIG,
  CLAUDE_DEFAULT_MODEL_CONFIG,
  CLAUDE_INSTANT_DEFAULT_MODEL_CONFIG,
];

const DATA_SOURCE_MODES = ["GENERIC", "SELECTED"] as const;
type DataSourceMode = (typeof DATA_SOURCE_MODES)[number];
const DATA_SOURCE_MODE_TO_LABEL: Record<DataSourceMode, string> = {
  GENERIC: "Generic model (No data source)",
  SELECTED: "Selected data sources",
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

export type AssistantBuilderDataSourceConfiguration = {
  dataSource: DataSourceType;
  selectedResources: Record<string, string>;
  isSelectAll: boolean;
};

type AssistantBuilderState = {
  dataSourceMode: DataSourceMode;
  dataSourceConfigurations: Record<
    string,
    AssistantBuilderDataSourceConfiguration
  >;
  timeFrameMode: TimeFrameMode;
  timeFrame: {
    value: number;
    unit: TimeframeUnit;
  };
  handle: string | null;
  description: string | null;
  instructions: string | null;
  avatarUrl: string | null;
  generationSettings: {
    modelSettings: SupportedModel;
    temperature: number;
  };
};

// initial state is like the state, but:
// - doesn't allow null handle/description/instructions
// - allows null timeFrame
// - allows null dataSourceConfigurations
export type AssistantBuilderInitialState = {
  dataSourceMode: AssistantBuilderState["dataSourceMode"];
  dataSourceConfigurations:
    | AssistantBuilderState["dataSourceConfigurations"]
    | null;
  timeFrameMode: TimeFrameMode | null;
  timeFrame: AssistantBuilderState["timeFrame"] | null;
  handle: string;
  description: string;
  instructions: string;
  avatarUrl: string;
  generationSettings: {
    modelSettings: SupportedModel;
    temperature: number;
  } | null;
};

type AssistantBuilderProps = {
  user: UserType;
  owner: WorkspaceType;
  gaTrackingId: string;
  dataSources: DataSourceType[];
  initialBuilderState: AssistantBuilderInitialState | null;
  agentConfigurationId: string | null;
};

const DEFAULT_ASSISTANT_STATE: AssistantBuilderState = {
  dataSourceMode: "GENERIC",
  dataSourceConfigurations: {},
  timeFrameMode: "AUTO",
  timeFrame: {
    value: 1,
    unit: "month",
  },
  handle: null,
  description: null,
  instructions: null,
  avatarUrl: null,
  generationSettings: {
    modelSettings: { modelId: "gpt-4", providerId: "openai" },
    temperature: 0.7,
  },
};

const CREATIVITY_LEVELS = [
  { label: "Deterministic", value: 0 },
  { label: "Factual", value: 0.2 },
  { label: "Balanced", value: 0.7 },
  { label: "Creative", value: 1 },
];

const getCreativityLevelFromTemperature = (temperature: number) => {
  const closest = CREATIVITY_LEVELS.reduce((prev, curr) =>
    Math.abs(curr.value - temperature) < Math.abs(prev.value - temperature)
      ? curr
      : prev
  );
  return closest;
};

export default function AssistantBuilder({
  user,
  owner,
  gaTrackingId,
  dataSources,
  initialBuilderState,
  agentConfigurationId,
}: AssistantBuilderProps) {
  const [builderState, setBuilderState] = useState<AssistantBuilderState>({
    ...DEFAULT_ASSISTANT_STATE,
    generationSettings: {
      ...DEFAULT_ASSISTANT_STATE.generationSettings,
      modelSettings: owner.plan.limits.largeModels
        ? GPT_4_DEFAULT_MODEL_CONFIG
        : GPT_3_5_TURBO_DEFAULT_MODEL_CONFIG,
    },
  });
  const [showDataSourcesModal, setShowDataSourcesModal] = useState(false);
  const [dataSourceToManage, setDataSourceToManage] =
    useState<AssistantBuilderDataSourceConfiguration | null>(null);
  const [edited, setEdited] = useState(false);
  const [submitEnabled, setSubmitEnabled] = useState(false);

  const [assistantHandleError, setAssistantHandleError] = useState<
    string | null
  >(null);
  const [timeFrameError, setTimeFrameError] = useState<string | null>(null);
  const { agentConfigurations } = useAgentConfigurations({
    workspaceId: owner.sId,
  });

  const [avatarUrls, setAvatarUrls] = useState<
    { available: boolean; url: string }[]
  >([]);
  const [isAvatarModalOpen, setIsAvatarModalOpen] = useState(false);

  const [showAdvancedSettings, setShowAdvancedSettings] = useState(false);

  useEffect(() => {
    if (agentConfigurations?.length) {
      const usedAvatarFiles = new Set(
        agentConfigurations
          .map((a) => a.pictureUrl.split(DROID_AVATARS_BASE_PATH)[1])
          .filter(Boolean)
      );
      const availableUrls = DROID_AVATAR_FILES.filter(
        (f) => !usedAvatarFiles.has(f)
      ).map((f) => `https://dust.tt/${DROID_AVATARS_BASE_PATH}${f}`);
      setAvatarUrls(
        DROID_AVATAR_FILES.map((f) => ({
          url: `https://dust.tt/${DROID_AVATARS_BASE_PATH}${f}`,
          available: !usedAvatarFiles.has(f),
        }))
      );
      // Only set a random avatar if one isn't already set
      if (!builderState.avatarUrl) {
        setBuilderState((state) => ({
          ...state,
          avatarUrl:
            availableUrls[Math.floor(Math.random() * availableUrls.length)],
        }));
      }
    }
  }, [
    agentConfigurations?.length,
    agentConfigurations,
    builderState.avatarUrl,
  ]);

  useEffect(() => {
    if (initialBuilderState) {
      setBuilderState({
        dataSourceMode: initialBuilderState.dataSourceMode,
        dataSourceConfigurations:
          initialBuilderState.dataSourceConfigurations ?? {
            ...DEFAULT_ASSISTANT_STATE.dataSourceConfigurations,
          },
        timeFrameMode:
          initialBuilderState.timeFrameMode ??
          DEFAULT_ASSISTANT_STATE.timeFrameMode,
        timeFrame: initialBuilderState.timeFrame ?? {
          ...DEFAULT_ASSISTANT_STATE.timeFrame,
        },
        handle: initialBuilderState.handle,
        description: initialBuilderState.description,
        instructions: initialBuilderState.instructions,
        avatarUrl: initialBuilderState.avatarUrl,
        generationSettings: initialBuilderState.generationSettings ?? {
          ...DEFAULT_ASSISTANT_STATE.generationSettings,
        },
      });
    }
  }, [initialBuilderState]);

  const removeLeadingAt = (handle: string) => {
    return handle.startsWith("@") ? handle.slice(1) : handle;
  };

  const assistantHandleIsValid = useCallback((handle: string) => {
    return /^[a-zA-Z0-9_-]{1,20}$/.test(removeLeadingAt(handle));
  }, []);

  const assistantHandleIsAvailable = useCallback(
    (handle: string) => {
      return !agentConfigurations.some(
        (agentConfiguration) =>
          agentConfiguration.name.toLowerCase() ===
            removeLeadingAt(handle).toLowerCase() &&
          initialBuilderState?.handle !== removeLeadingAt(handle)
      );
    },
    [agentConfigurations, initialBuilderState?.handle]
  );

  const configuredDataSourceCount = Object.keys(
    builderState.dataSourceConfigurations
  ).length;

  const formValidation = useCallback(async () => {
    let valid = true;
    let edited = false;

    if (!builderState.handle || builderState.handle === "@") {
      setAssistantHandleError(null);
      valid = false;
    } else {
      edited = true;
      if (!assistantHandleIsValid(builderState.handle)) {
        setAssistantHandleError("Only letters, numbers, _ and - allowed");
        valid = false;
      } else if (!assistantHandleIsAvailable(builderState.handle)) {
        setAssistantHandleError("Assistant handle is already taken");
        valid = false;
      } else {
        setAssistantHandleError(null);
      }
    }

    if (!builderState.description?.trim()) {
      valid = false;
    } else {
      edited = true;
    }

    if (!builderState.instructions?.trim()) {
      valid = false;
    } else {
      edited = true;
    }

    if (builderState.dataSourceMode === "SELECTED") {
      edited = true;

      if (!configuredDataSourceCount) {
        valid = false;
      }
    }

    if (builderState.timeFrameMode === "CUSTOM") {
      edited = true;

      if (!builderState.timeFrame.value) {
        valid = false;
        setTimeFrameError("Timeframe must be a number");
      } else {
        setTimeFrameError(null);
      }
    }

    setSubmitEnabled(valid);
    setEdited(edited);
  }, [
    builderState.handle,
    builderState.description,
    builderState.instructions,
    builderState.dataSourceMode,
    configuredDataSourceCount,
    builderState.timeFrameMode,
    builderState.timeFrame.value,
    assistantHandleIsAvailable,
    assistantHandleIsValid,
  ]);

  useEffect(() => {
    void formValidation();
  }, [formValidation]);

  const configurableDataSources = dataSources.filter(
    (dataSource) => !builderState.dataSourceConfigurations[dataSource.name]
  );

  const deleteDataSource = (name: string) => {
    setBuilderState(({ dataSourceConfigurations, ...rest }) => {
      const newConfigs = { ...dataSourceConfigurations };
      delete newConfigs[name];
      return { ...rest, dataSourceConfigurations: newConfigs };
    });
  };

  const submitForm = async () => {
    if (
      !builderState.handle ||
      !builderState.description ||
      !builderState.instructions ||
      !builderState.avatarUrl
    ) {
      // should be unreachable
      // we keep this for TS
      throw new Error("Form not valid");
    }

    type BodyType = t.TypeOf<
      typeof PostOrPatchAgentConfigurationRequestBodySchema
    >;

    let actionParam: BodyType["assistant"]["action"] | null = null;
    switch (builderState.dataSourceMode) {
      case "GENERIC":
        break;
      case "SELECTED":
        const tfParam = (() => {
          switch (builderState.timeFrameMode) {
            case "AUTO":
              return "auto";
            case "ALL_TIME":
              return "none";
            case "CUSTOM":
              if (!builderState.timeFrame.value) {
                // unreachable
                // we keep this for TS
                throw new Error("Form not valid");
              }
              return {
                duration: builderState.timeFrame.value,
                unit: builderState.timeFrame.unit,
              };
            default:
              ((x: never) => {
                throw new Error(`Unknown time frame mode ${x}`);
              })(builderState.timeFrameMode);
          }
        })();

        actionParam = {
          type: "retrieval_configuration",
          query: "auto", // TODO ?
          timeframe: tfParam,
          topK: 16, // TODO ?
          dataSources: Object.values(builderState.dataSourceConfigurations).map(
            ({ dataSource, selectedResources, isSelectAll }) => ({
              dataSourceId: dataSource.name,
              workspaceId: owner.sId,
              filter: {
                parents: !isSelectAll
                  ? { in: Object.keys(selectedResources), not: [] }
                  : null,
                tags: null,
              },
            })
          ),
        };
        break;

      default:
        ((x: never) => {
          throw new Error(`Unknown data source mode ${x}`);
        })(builderState.dataSourceMode);
    }

    const body: t.TypeOf<
      typeof PostOrPatchAgentConfigurationRequestBodySchema
    > = {
      assistant: {
        name: removeLeadingAt(builderState.handle),
        pictureUrl: builderState.avatarUrl,
        description: builderState.description.trim(),
        status: "active",
        action: actionParam,
        generation: {
          prompt: builderState.instructions.trim(),
          model: builderState.generationSettings.modelSettings,
          temperature: builderState.generationSettings.temperature,
        },
      },
    };

    const res = await fetch(
      !agentConfigurationId
        ? `/api/w/${owner.sId}/assistant/agent_configurations`
        : `/api/w/${owner.sId}/assistant/agent_configurations/${agentConfigurationId}`,
      {
        method: !agentConfigurationId ? "POST" : "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      }
    );

    if (!res.ok) {
      throw new Error("An error occured");
    }

    return res.json();
  };

  const handleDeleteAgent = async () => {
    const res = await fetch(
      `/api/w/${owner.sId}/assistant/agent_configurations/${agentConfigurationId}`,
      {
        method: "DELETE",
      }
    );

    if (!res.ok) {
      const data = await res.json();
      window.alert(`Error deleting Assistant: ${data.error.message}`);
      return;
    }

    await router.push(`/w/${owner.sId}/builder/assistants`);
  };

  return (
    <>
      <AssistantBuilderDataSourceModal
        isOpen={showDataSourcesModal}
        setOpen={(isOpen) => {
          setShowDataSourcesModal(isOpen);
          if (!isOpen) {
            setDataSourceToManage(null);
          }
        }}
        owner={owner}
        dataSources={configurableDataSources}
        onSave={({ dataSource, selectedResources, isSelectAll }) => {
          setBuilderState((state) => ({
            ...state,
            dataSourceConfigurations: {
              ...state.dataSourceConfigurations,
              [dataSource.name]: {
                dataSource,
                selectedResources,
                isSelectAll,
              },
            },
          }));
        }}
        dataSourceToManage={dataSourceToManage}
      />
      <AvatarPicker
        isOpen={isAvatarModalOpen}
        setOpen={setIsAvatarModalOpen}
        onPick={(avatarUrl) => {
          setBuilderState((state) => ({
            ...state,
            avatarUrl,
          }));
        }}
        avatarUrls={avatarUrls}
      />
      <AppLayout
        user={user}
        owner={owner}
        gaTrackingId={gaTrackingId}
        topNavigationCurrent="settings"
        subNavigation={subNavigationAdmin({
          owner,
          current: "assistants",
        })}
        titleChildren={
          !edited ? (
            <AppLayoutSimpleCloseTitle
              title="Design your custom Assistant"
              onClose={() => {
                void router.push(`/w/${owner.sId}/builder/assistants`);
              }}
            />
          ) : (
            <AppLayoutSimpleSaveCancelTitle
              title="Design your custom Assistant"
              onCancel={() => {
                void router.push(`/w/${owner.sId}/builder/assistants`);
              }}
              onSave={
                submitEnabled
                  ? () => {
                      submitForm()
                        .then(() => {
                          void router.push(
                            `/w/${owner.sId}/builder/assistants`
                          );
                        })
                        .catch((e) => {
                          console.error(e);
                          alert("An error occured");
                        });
                    }
                  : undefined
              }
            />
          )
        }
      >
        <div className="flex flex-col space-y-8 pb-8 pt-8">
          <div className="flex flex-row items-start gap-8">
            <div className="flex flex-col gap-4">
              <div className="text-lg font-bold text-element-900">
                Handle / Name
              </div>
              <div className="flex-grow self-stretch text-sm font-normal text-element-800">
                The handle of your assistant will be used to call it with an “@”
                handle (for instance @myAssistant).
              </div>
              <div className="text-sm">
                <Input
                  placeholder="SalesAssistantFrance"
                  value={builderState.handle}
                  onChange={(value) => {
                    setBuilderState((state) => ({
                      ...state,
                      handle: value.trim(),
                    }));
                  }}
                  error={assistantHandleError}
                  name="assistantName"
                  showErrorLabel
                  className="text-sm"
                />
              </div>
              <div className="text-lg font-bold text-element-900">
                Description
              </div>
              <div className="flex-grow self-stretch text-sm font-normal text-element-800">
                The description helps your collaborators and Dust to understand
                the purpose of the assistant. It must be descriptive and short.
              </div>
              <div className="text-sm">
                <Input
                  placeholder="Assistant designed to answer sales questions"
                  value={builderState.description}
                  onChange={(value) => {
                    setBuilderState((state) => ({
                      ...state,
                      description: value,
                    }));
                  }}
                  error={null} // TODO ?
                  name="assistantDescription"
                  className="text-sm"
                />
              </div>
            </div>
            <div className="flex flex-col items-center space-y-2">
              <Avatar
                size="xl"
                visual={<img src={builderState.avatarUrl || ""} />}
              />
              <Button
                labelVisible={true}
                label="Change"
                variant="tertiary"
                size="xs"
                icon={PencilSquareIcon}
                onClick={() => {
                  setIsAvatarModalOpen(true);
                }}
              />
            </div>
          </div>
          <div className="mt-8 flex w-full flex-row items-start">
            <div className="flex w-full flex-col gap-4">
              <div className="text-lg font-bold text-element-900">
                Instructions
              </div>
              <div className="flex-grow self-stretch text-sm font-normal text-element-800">
                This is the heart and soul of your assistant. Describe, to your
                assistant, its mission and purpose. Be specific on the role, the
                expected output, the type of formatting.{" "}
                <a className="font-bold text-action-500">See examples</a>
              </div>
              <div className="text-sm">
                <AssistantBuilderTextArea
                  placeholder="Achieve a particular task, follow a template, use a certain formating..."
                  value={builderState.instructions}
                  onChange={(value) => {
                    setBuilderState((state) => ({
                      ...state,
                      instructions: value,
                    }));
                  }}
                  error={null}
                  name="assistantInstructions"
                />
              </div>
              <div
                className="flex cursor-pointer flex-row items-center space-x-2"
                onClick={() => setShowAdvancedSettings(!showAdvancedSettings)}
              >
                <Icon
                  size="xs"
                  visual={
                    showAdvancedSettings ? ChevronDownIcon : ChevronUpIcon
                  }
                  className="text-element-700"
                />
                <div className="text-sm font-semibold text-action-500">
                  Advanced Settings
                </div>
              </div>
              <AdvancedSettings
                owner={owner}
                show={showAdvancedSettings}
                generationSettings={builderState.generationSettings}
                setGenerationSettings={(generationSettings) => {
                  setBuilderState((state) => ({
                    ...state,
                    generationSettings,
                  }));
                }}
              />
            </div>
          </div>
          <div className="flex flex-row items-start">
            <div className="flex flex-col gap-4">
              <div className="text-lg font-bold text-element-900">
                Data sources
              </div>
              <div className="text-sm text-element-700">
                Customize your Assistant's knowledge !
              </div>
              <ul role="list" className="flex flex-row gap-12">
                <li className="flex flex-1">
                  <div className="flex flex-col">
                    <div className="text-base font-bold text-element-800">
                      Setting data sources is not an obligation.
                    </div>
                    <div className="text-sm text-element-700">
                      By default, your assistant will follow your instructions
                      and answer based on commun knowledge.
                    </div>
                  </div>
                </li>
                <li className="flex flex-1">
                  <div className="flex flex-col">
                    <div className="text-base font-bold text-element-800">
                      Choose your data sources with care.
                    </div>
                    <div className="text-sm text-element-700">
                      The more targeted your data the better the answers will
                      be.
                    </div>
                  </div>
                </li>
              </ul>
              <div className="flex flex-row items-center space-x-2 pt-6">
                <div className="text-sm font-semibold text-element-900">
                  Data source mode:
                </div>
                <DropdownMenu>
                  <DropdownMenu.Button>
                    <Button
                      type="select"
                      labelVisible={true}
                      label={
                        DATA_SOURCE_MODE_TO_LABEL[builderState.dataSourceMode]
                      }
                      variant="secondary"
                      size="sm"
                    />
                  </DropdownMenu.Button>
                  <DropdownMenu.Items origin="topRight" width={260}>
                    {Object.entries(DATA_SOURCE_MODE_TO_LABEL).map(
                      ([key, value]) => (
                        <DropdownMenu.Item
                          key={key}
                          label={value}
                          onClick={() => {
                            setBuilderState((state) => ({
                              ...state,
                              dataSourceMode: key as DataSourceMode,
                            }));
                          }}
                        />
                      )
                    )}
                  </DropdownMenu.Items>
                </DropdownMenu>
              </div>
              <div className="pb-8">
                <DataSourceSelectionSection
                  show={builderState.dataSourceMode === "SELECTED"}
                  dataSourceConfigurations={
                    builderState.dataSourceConfigurations
                  }
                  openDataSourceModal={() => {
                    setShowDataSourcesModal(true);
                  }}
                  canAddDataSource={configurableDataSources.length > 0}
                  onManageDataSource={(name) => {
                    setDataSourceToManage(
                      builderState.dataSourceConfigurations[name]
                    );
                    setShowDataSourcesModal(true);
                  }}
                  onDelete={deleteDataSource}
                  timeFrameMode={builderState.timeFrameMode}
                  setTimeFrameMode={(timeFrameMode: TimeFrameMode) => {
                    setBuilderState((state) => ({
                      ...state,
                      timeFrameMode,
                    }));
                  }}
                  timeFrame={builderState.timeFrame}
                  setTimeFrame={(timeFrame) => {
                    setBuilderState((state) => ({
                      ...state,
                      timeFrame,
                    }));
                  }}
                  timeFrameError={timeFrameError}
                />
              </div>
            </div>
          </div>
          {agentConfigurationId && (
            <div>
              <DropdownMenu>
                <DropdownMenu.Button>
                  <Button
                    size="sm"
                    variant="secondaryWarning"
                    label="Delete this Assistant"
                    icon={TrashIcon}
                  />
                </DropdownMenu.Button>
                <DropdownMenu.Items origin="bottomLeft" width={280}>
                  <div className="flex flex-col gap-y-4 py-4">
                    <div className="flex flex-col gap-y-2">
                      <div className="grow text-sm font-medium text-element-800">
                        Are you sure you want to delete?
                      </div>

                      <div className="text-sm font-normal text-element-700">
                        This will delete the Assistant for everyone.
                      </div>
                    </div>
                    <div className="flex justify-center">
                      <Button
                        variant="primaryWarning"
                        size="sm"
                        label="Delete for Everyone"
                        icon={TrashIcon}
                        onClick={handleDeleteAgent}
                      />
                    </div>
                  </div>
                </DropdownMenu.Items>
              </DropdownMenu>
            </div>
          )}
        </div>
      </AppLayout>
    </>
  );
}

function AssistantBuilderTextArea({
  placeholder,
  value,
  onChange,
  error,
  name,
}: {
  placeholder: string;
  value: string | null;
  onChange: (value: string) => void;
  error?: string | null;
  name: string;
}) {
  return (
    <ReactTextareaAutosize
      name="name"
      id={name}
      className={classNames(
        "block max-h-64 min-h-48 w-full min-w-0 rounded-md text-sm",
        !error
          ? "border-gray-300 focus:border-action-500 focus:ring-action-500"
          : "border-red-500 focus:border-red-500 focus:ring-red-500",
        "bg-structure-50 stroke-structure-50"
      )}
      placeholder={placeholder}
      value={value ?? ""}
      onChange={(e) => {
        onChange(e.target.value);
      }}
    />
  );
}

function AvatarPicker({
  isOpen,
  setOpen,
  onPick,
  avatarUrls,
}: {
  isOpen: boolean;
  setOpen: (isOpen: boolean) => void;
  onPick: (avatar: string) => void;
  avatarUrls: { available: boolean; url: string }[];
}) {
  return (
    <Modal
      isOpen={isOpen}
      onClose={() => setOpen(false)}
      title="Pick an Avatar for your assistant:"
      isFullScreen={false}
      hasChanged={false}
    >
      <div className="grid max-w-3xl grid-cols-8 gap-4 pt-8">
        {avatarUrls.map(({ available, url }) => (
          <div
            key={url}
            className={classNames(available ? "cursor-pointer" : "opacity-30")}
            onClick={() => {
              if (available) {
                onPick(url);
                setOpen(false);
              }
            }}
          >
            <Avatar size="lg" visual={<img src={url} />} />
          </div>
        ))}
      </div>
    </Modal>
  );
}

function AdvancedSettings({
  owner,
  show,
  generationSettings,
  setGenerationSettings,
}: {
  owner: WorkspaceType;
  show: boolean;
  generationSettings: AssistantBuilderState["generationSettings"];
  setGenerationSettings: (
    generationSettingsSettings: AssistantBuilderState["generationSettings"]
  ) => void;
}) {
  const supportedModelConfig = getSupportedModelConfig(
    generationSettings.modelSettings
  );
  if (!supportedModelConfig) {
    // unreachable
    alert("Unsupported model");
  }
  return (
    <Transition
      show={show}
      enterFrom="opacity-0"
      enterTo="opacity-100"
      leave="transition-all duration-300"
      enter="transition-all duration-300"
      leaveFrom="opacity-100"
      leaveTo="opacity-0"
    >
      <div className="flex flex-row items-center gap-12">
        <div className="flex flex-1 flex-row items-center gap-2">
          <div className="text-sm font-semibold text-element-900">
            Model selection:
          </div>
          <DropdownMenu>
            <DropdownMenu.Button>
              <Button
                type="select"
                labelVisible={true}
                label={
                  getSupportedModelConfig(generationSettings.modelSettings)
                    .displayName
                }
                variant="secondary"
                size="sm"
              />
            </DropdownMenu.Button>
            <DropdownMenu.Items origin="topLeft">
              {usedModelConfigs
                .filter(
                  (modelConfig) =>
                    !modelConfig.largeModel || owner.plan.limits.largeModels
                )
                .map((modelConfig) => (
                  <DropdownMenu.Item
                    key={modelConfig.modelId}
                    label={modelConfig.displayName}
                    onClick={() => {
                      setGenerationSettings({
                        ...generationSettings,
                        modelSettings: {
                          modelId: modelConfig.modelId,
                          providerId: modelConfig.providerId,
                          // safe because the SupportedModel is derived from the SUPPORTED_MODEL_CONFIGS array
                        } as SupportedModel,
                      });
                    }}
                  />
                ))}
            </DropdownMenu.Items>
          </DropdownMenu>
        </div>
        <div className="flex flex-1 flex-row items-center gap-2">
          <div className="text-sm font-semibold text-element-900">
            Creativity level:
          </div>
          <DropdownMenu>
            <DropdownMenu.Button>
              <Button
                type="select"
                labelVisible={true}
                label={
                  getCreativityLevelFromTemperature(
                    generationSettings?.temperature
                  ).label
                }
                variant="secondary"
                size="sm"
              />
            </DropdownMenu.Button>
            <DropdownMenu.Items origin="topLeft">
              {CREATIVITY_LEVELS.map(({ label, value }) => (
                <DropdownMenu.Item
                  key={label}
                  label={label}
                  onClick={() => {
                    setGenerationSettings({
                      ...generationSettings,
                      temperature: value,
                    });
                  }}
                />
              ))}
            </DropdownMenu.Items>
          </DropdownMenu>
        </div>
      </div>
    </Transition>
  );
}
