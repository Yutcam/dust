import { Op, Transaction } from "sequelize";

import { Authenticator } from "@app/lib/auth";
import { front_sequelize, ModelId } from "@app/lib/databases";
import {
  AgentConfiguration,
  AgentDataSourceConfiguration,
  AgentGenerationConfiguration,
  AgentRetrievalConfiguration,
  DataSource,
  Workspace,
} from "@app/lib/models";
import { generateModelSId } from "@app/lib/utils";
import {
  AgentDataSourceConfigurationType,
  isTemplatedQuery,
  isTimeFrame,
  RetrievalQuery,
  RetrievalTimeframe,
} from "@app/types/assistant/actions/retrieval";
import {
  AgentActionConfigurationType,
  AgentConfigurationStatus,
  AgentConfigurationType,
  AgentGenerationConfigurationType,
} from "@app/types/assistant/configuration";

/**
 * Get an agent configuration
 */
export async function getAgentConfiguration(
  auth: Authenticator,
  agentId: string
): Promise<AgentConfigurationType> {
  const owner = auth.workspace();
  if (!owner) {
    throw new Error("Cannot find Agent: no workspace");
  }
  const agent = await AgentConfiguration.findOne({
    where: {
      sId: agentId,
      workspaceId: owner.id,
    },
  });
  if (!agent) {
    throw new Error("Cannot find Agent: no workspace");
  }

  const generationConfig = agent.generationConfigId
    ? await AgentGenerationConfiguration.findOne({
        where: {
          id: agent.generationConfigId,
        },
      })
    : null;

  const actionConfig = agent.retrievalConfigId
    ? await AgentRetrievalConfiguration.findOne({
        where: {
          id: agent.retrievalConfigId,
        },
      })
    : null;
  const dataSourcesConfig = actionConfig?.id
    ? await AgentDataSourceConfiguration.findAll({
        where: {
          retrievalConfigId: actionConfig.id,
        },
      })
    : [];

  return {
    sId: agent.sId,
    name: agent.name,
    pictureUrl: agent.pictureUrl,
    status: agent.status,
    action: actionConfig
      ? await renderAgentActionConfigurationType(
          actionConfig,
          dataSourcesConfig
        )
      : null,
    generation: generationConfig
      ? {
          id: generationConfig.id,
          prompt: generationConfig.prompt,
          model: {
            providerId: generationConfig.providerId,
            modelId: generationConfig.modelId,
          },
        }
      : null,
  };
}

/**
 * Create Agent Configuration
 */
export async function createAgentConfiguration(
  auth: Authenticator,
  {
    name,
    pictureUrl,
    status,
    generationConfigId,
    actionConfigId,
  }: {
    name: string;
    pictureUrl: string;
    status: AgentConfigurationStatus;
    generationConfigId: ModelId | null;
    actionConfigId: ModelId | null;
  }
): Promise<AgentConfigurationType> {
  const owner = auth.workspace();
  if (!owner) {
    throw new Error("Cannot create AgentConfiguration without workspace");
  }

  // Create Agent config
  const agentConfig = await AgentConfiguration.create({
    sId: generateModelSId(),
    status: status,
    name: name,
    pictureUrl: pictureUrl,
    scope: "workspace",
    workspaceId: owner.id,
    generationConfigId: generationConfigId,
    retrievalConfigId: actionConfigId,
  });

  // Return the config with Generation and Action if any
  const generationConfig = agentConfig.generationConfigId
    ? await AgentGenerationConfiguration.findOne({
        where: {
          id: agentConfig.generationConfigId,
        },
      })
    : null;
  const actionConfig = agentConfig.retrievalConfigId
    ? await AgentRetrievalConfiguration.findOne({
        where: {
          id: agentConfig.retrievalConfigId,
        },
      })
    : null;
  const dataSourcesConfig = actionConfig?.id
    ? await AgentDataSourceConfiguration.findAll({
        where: {
          retrievalConfigId: actionConfig.id,
        },
      })
    : [];

  return {
    sId: agentConfig.sId,
    name: agentConfig.name,
    pictureUrl: agentConfig.pictureUrl,
    status: agentConfig.status,
    action: actionConfig
      ? await renderAgentActionConfigurationType(
          actionConfig,
          dataSourcesConfig
        )
      : null,
    generation: generationConfig
      ? {
          id: generationConfig.id,
          prompt: generationConfig.prompt,
          model: {
            providerId: generationConfig.providerId,
            modelId: generationConfig.modelId,
          },
        }
      : null,
  };
}

/**
 * Create Agent Generation Configuration
 */
export async function createAgentGenerationConfiguration(
  auth: Authenticator,
  {
    prompt,
    model,
  }: {
    prompt: string;
    model: {
      providerId: string;
      modelId: string;
    };
  }
): Promise<AgentGenerationConfigurationType> {
  const owner = auth.workspace();
  if (!owner) {
    throw new Error("Cannot create AgentConfiguration without workspace");
  }

  const genConfig = await AgentGenerationConfiguration.create({
    prompt: prompt,
    providerId: model.providerId,
    modelId: model.modelId,
  });

  return {
    id: genConfig.id,
    prompt: genConfig.prompt,
    model: {
      providerId: genConfig.providerId,
      modelId: genConfig.modelId,
    },
  };
}

/**
 * Create Agent RetrievalConfiguration
 */
export async function createAgentActionConfiguration(
  auth: Authenticator,
  {
    type,
    query,
    timeframe,
    topK,
    dataSources,
  }: {
    type: string;
    query: RetrievalQuery;
    timeframe: RetrievalTimeframe;
    topK: number;
    dataSources: AgentDataSourceConfigurationType[];
  }
): Promise<AgentActionConfigurationType> {
  const owner = auth.workspace();
  if (!owner) {
    throw new Error("Cannot create AgentConfiguration without workspace");
  }

  return await front_sequelize.transaction(async (t) => {
    let retrievalConfig: AgentRetrievalConfiguration | null = null;
    let dataSourcesConfig: AgentDataSourceConfiguration[] = [];

    if (type !== "retrieval_configuration") {
      throw new Error("Unkown Agent action type");
    }

    // Create Retrieval & Datasources configs
    retrievalConfig = await AgentRetrievalConfiguration.create(
      {
        query: isTemplatedQuery(query) ? "templated" : query,
        queryTemplate: isTemplatedQuery(query) ? query.template : null,
        relativeTimeFrame: isTimeFrame(timeframe) ? "custom" : timeframe,
        relativeTimeFrameDuration: isTimeFrame(timeframe)
          ? timeframe.duration
          : null,
        relativeTimeFrameUnit: isTimeFrame(timeframe) ? timeframe.unit : null,
        topK: topK,
      },
      { transaction: t }
    );
    dataSourcesConfig = await _createAgentDataSourcesConfigData(
      t,
      dataSources,
      retrievalConfig.id
    );

    return await renderAgentActionConfigurationType(
      retrievalConfig,
      dataSourcesConfig
    );
  });
}

/**
 * Update Agent Configuration
 */
export async function updateAgentConfiguration(
  auth: Authenticator,
  agentId: string,
  {
    name,
    pictureUrl,
    status,
  }: {
    name: string;
    pictureUrl: string;
    status: AgentConfigurationStatus;
  }
): Promise<AgentConfigurationType> {
  const owner = auth.workspace();
  if (!owner) {
    throw new Error(
      "Cannot create AgentGenerationConfiguration: Workspace not found"
    );
  }
  const agentConfig = await AgentConfiguration.findOne({
    where: {
      sId: agentId,
    },
  });
  if (!agentConfig) {
    throw new Error(
      "Cannot create AgentGenerationConfiguration: Agent not found"
    );
  }
  // Updating Agent Config
  const updatedAgentConfig = await agentConfig.update({
    name: name,
    pictureUrl: pictureUrl,
    status: status,
  });

  // Return the config with Generation and Action if any
  const existingGeneration = agentConfig.generationConfigId
    ? await AgentGenerationConfiguration.findOne({
        where: {
          id: agentConfig.generationConfigId,
        },
      })
    : null;

  const existingRetrivalConfig = agentConfig.retrievalConfigId
    ? await AgentRetrievalConfiguration.findOne({
        where: {
          id: agentConfig.retrievalConfigId,
        },
      })
    : null;

  const existingDataSourcesConfig = existingRetrivalConfig?.id
    ? await AgentDataSourceConfiguration.findAll({
        where: {
          retrievalConfigId: existingRetrivalConfig.id,
        },
      })
    : [];

  return {
    sId: updatedAgentConfig.sId,
    name: updatedAgentConfig.name,
    pictureUrl: updatedAgentConfig.pictureUrl,
    status: updatedAgentConfig.status,
    action: existingRetrivalConfig
      ? await renderAgentActionConfigurationType(
          existingRetrivalConfig,
          existingDataSourcesConfig
        )
      : null,
    generation: existingGeneration
      ? {
          id: existingGeneration.id,
          prompt: existingGeneration.prompt,
          model: {
            providerId: existingGeneration.providerId,
            modelId: existingGeneration.modelId,
          },
        }
      : null,
  };
}

/**
 * Update Agent Configuration
 */
export async function updateAgentGenerationConfiguration(
  auth: Authenticator,
  agentId: string,
  {
    name,
    pictureUrl,
    status,
    generation,
  }: {
    name: string;
    pictureUrl: string;
    status: AgentConfigurationStatus;
    generation: {
      prompt: string;
      model: {
        providerId: string;
        modelId: string;
      };
    } | null;
  }
): Promise<AgentConfigurationType> {
  const owner = auth.workspace();
  if (!owner) {
    throw new Error(
      "Cannot create AgentGenerationConfiguration: Workspace not found"
    );
  }
  const agentConfig = await AgentConfiguration.findOne({
    where: {
      sId: agentId,
    },
  });
  if (!agentConfig) {
    throw new Error(
      "Cannot create AgentGenerationConfiguration: Agent not found"
    );
  }
  const existingGeneration = agentConfig.generationConfigId
    ? await AgentGenerationConfiguration.findOne({
        where: {
          id: agentConfig.generationConfigId,
        },
      })
    : null;

  const existingRetrivalConfig = agentConfig.retrievalConfigId
    ? await AgentRetrievalConfiguration.findOne({
        where: {
          id: agentConfig.retrievalConfigId,
        },
      })
    : null;

  const existingDataSourcesConfig = existingRetrivalConfig?.id
    ? await AgentDataSourceConfiguration.findAll({
        where: {
          retrievalConfigId: existingRetrivalConfig.id,
        },
      })
    : [];

  return await front_sequelize.transaction(async (t) => {
    // Updating Agent Config
    const updatedAgentConfig = await agentConfig.update(
      {
        name: name,
        pictureUrl: pictureUrl,
        status: status,
      },
      { transaction: t }
    );

    // Upserting Generation Config
    let upsertedGenerationConfig: AgentGenerationConfiguration | null = null;
    if (generation) {
      const { prompt, model } = generation;
      if (existingGeneration) {
        upsertedGenerationConfig = await existingGeneration.update(
          {
            prompt: prompt,
            providerId: model.providerId,
            modelId: model.modelId,
          },
          { transaction: t }
        );
      } else {
        upsertedGenerationConfig = await AgentGenerationConfiguration.create(
          {
            prompt: prompt,
            providerId: model.providerId,
            modelId: model.modelId,
          },
          { transaction: t }
        );
      }
    } else if (existingGeneration) {
      await existingGeneration.destroy();
    }

    return {
      sId: updatedAgentConfig.sId,
      name: updatedAgentConfig.name,
      pictureUrl: updatedAgentConfig.pictureUrl,
      status: updatedAgentConfig.status,
      action: existingRetrivalConfig
        ? await renderAgentActionConfigurationType(
            existingRetrivalConfig,
            existingDataSourcesConfig
          )
        : null,
      generation:
        generation && upsertedGenerationConfig
          ? {
              id: upsertedGenerationConfig.id,
              prompt: upsertedGenerationConfig.prompt,
              model: {
                providerId: upsertedGenerationConfig.providerId,
                modelId: upsertedGenerationConfig.modelId,
              },
            }
          : null,
    };
  });
}

/**
 * Update Agent Retrieval Configuration
 * This will destroy and recreate the retrieval config
 */
export async function updateAgentActionConfiguration(
  auth: Authenticator,
  agentId: string,
  {
    type,
    query,
    timeframe,
    topK,
    dataSources,
  }: {
    type: string;
    query: RetrievalQuery;
    timeframe: RetrievalTimeframe;
    topK: number;
    dataSources: AgentDataSourceConfigurationType[];
  }
): Promise<AgentActionConfigurationType> {
  const owner = auth.workspace();
  if (!owner) {
    throw new Error(
      "Cannot create AgentGenerationConfiguration: Workspace not found"
    );
  }
  if (type !== "retrieval_configuration") {
    throw new Error("Unkown Agent action type");
  }

  const agentConfig = await AgentConfiguration.findOne({
    where: {
      sId: agentId,
    },
  });
  if (!agentConfig) {
    throw new Error(
      "Cannot create AgentGenerationConfiguration: Agent not found"
    );
  }

  if (!agentConfig.retrievalConfigId) {
    throw new Error(
      "Cannot update Agent Retrieval Configuration: Agent has no retrieval config"
    );
  }
  const existingRetrievalConfig = await AgentRetrievalConfiguration.findOne({
    where: {
      id: agentConfig.retrievalConfigId,
    },
  });
  if (!existingRetrievalConfig) {
    throw new Error(
      "Cannot update Agent Retrieval Configuration: Retrieval config not found"
    );
  }

  return await front_sequelize.transaction(async (t) => {
    const updatedRetrievalConfig = await existingRetrievalConfig.update(
      {
        query: isTemplatedQuery(query) ? "templated" : query,
        queryTemplate: isTemplatedQuery(query) ? query.template : null,
        relativeTimeFrame: isTimeFrame(timeframe) ? "custom" : timeframe,
        relativeTimeFrameDuration: isTimeFrame(timeframe)
          ? timeframe.duration
          : null,
        relativeTimeFrameUnit: isTimeFrame(timeframe) ? timeframe.unit : null,
        topK: topK,
      },
      { transaction: t }
    );

    // Destroy existing dataSources config
    await AgentDataSourceConfiguration.destroy({
      where: {
        retrievalConfigId: existingRetrievalConfig.id,
      },
    });

    // Create new dataSources config
    const dataSourcesConfig = await _createAgentDataSourcesConfigData(
      t,
      dataSources,
      updatedRetrievalConfig.id
    );

    return await renderAgentActionConfigurationType(
      updatedRetrievalConfig,
      dataSourcesConfig
    );
  });
}

/**
 * Builds the agent action configuration type from the model
 */
async function renderAgentActionConfigurationType(
  action: AgentRetrievalConfiguration,
  dataSourcesConfig: AgentDataSourceConfiguration[]
): Promise<AgentActionConfigurationType> {
  // Build Retrieval Timeframe
  let timeframe: RetrievalTimeframe = "auto";
  if (
    action.relativeTimeFrame === "custom" &&
    action.relativeTimeFrameDuration &&
    action.relativeTimeFrameUnit
  ) {
    timeframe = {
      duration: action.relativeTimeFrameDuration,
      unit: action.relativeTimeFrameUnit,
    };
  } else if (action.relativeTimeFrame === "none") {
    timeframe = "none";
  }

  // Build Retrieval Query
  let query: RetrievalQuery = "auto";
  if (action.query === "templated" && action.queryTemplate) {
    query = {
      template: action.queryTemplate,
    };
  } else if (action.query === "none") {
    query = "none";
  }

  // Build Retrieval DataSources
  const dataSourcesIds = dataSourcesConfig?.map((ds) => ds.dataSourceId);
  const dataSources = await DataSource.findAll({
    where: {
      id: { [Op.in]: dataSourcesIds },
    },
    attributes: ["id", "name", "workspaceId"],
  });
  const workspaceIds = dataSources.map((ds) => ds.workspaceId);
  const workspaces = await Workspace.findAll({
    where: {
      id: { [Op.in]: workspaceIds },
    },
    attributes: ["id", "sId"],
  });

  let dataSource: DataSource | undefined;
  let workspace: Workspace | undefined;
  const dataSourcesConfigType: AgentDataSourceConfigurationType[] = [];

  dataSourcesConfig.forEach(async (dsConfig) => {
    dataSource = dataSources.find((ds) => ds.id === dsConfig.dataSourceId);
    workspace = workspaces.find((w) => w.id === dataSource?.workspaceId);

    if (!dataSource || !workspace) {
      throw new Error("Could not find dataSource or workspace");
    }

    dataSourcesConfigType.push({
      dataSourceId: dataSource.name,
      workspaceId: workspace.sId,
      filter: {
        tags:
          dsConfig.tagsIn && dsConfig.tagsNotIn
            ? { in: dsConfig.tagsIn, not: dsConfig.tagsNotIn }
            : null,
        parents:
          dsConfig.parentsIn && dsConfig.parentsNotIn
            ? { in: dsConfig.parentsIn, not: dsConfig.parentsNotIn }
            : null,
      },
    });
  });

  return {
    id: action.id,
    type: "retrieval_configuration",
    query: query,
    relativeTimeFrame: timeframe,
    topK: action.topK,
    dataSources: dataSourcesConfigType,
  };
}

/**
 * Create the AgentDataSourceConfiguration rows in database.
 *
 * Knowing that a datasource is uniquely identified by its name and its workspaceId
 * We need to fetch the dataSources from the database from that.
 * We obvisously need to do as few queries as possible.
 */
export async function _createAgentDataSourcesConfigData(
  t: Transaction,
  dataSourcesConfig: AgentDataSourceConfigurationType[],
  retrievalConfigId: number
): Promise<AgentDataSourceConfiguration[]> {
  // dsConfig contains this format:
  // [
  //   { workspaceSId: s1o1u1p, dataSourceName: "managed-notion", filter: { tags: null, parents: null } },
  //   { workspaceSId: s1o1u1p, dataSourceName: "managed-slack", filter: { tags: null, parents: null } },
  //   { workspaceSId: i2n2o2u, dataSourceName: "managed-notion", filter: { tags: null, parents: null } },
  // ]

  // First we get the list of workspaces because we need the mapping between workspaceSId and workspaceId
  const workspaces = await Workspace.findAll({
    where: {
      sId: dataSourcesConfig.map((dsConfig) => dsConfig.workspaceId),
    },
    attributes: ["id", "sId"],
  });

  // Now will want to group the datasource names by workspaceId to do only one query per workspace.
  // We want this:
  // [
  //   { workspaceId: 1, dataSourceNames: [""managed-notion", "managed-slack"] },
  //   { workspaceId: 2, dataSourceNames: ["managed-notion"] }
  // ]
  type _DsNamesPerWorkspaceIdType = {
    workspaceId: number;
    dataSourceNames: string[];
  };
  const dsNamesPerWorkspaceId = dataSourcesConfig.reduce(
    (
      acc: _DsNamesPerWorkspaceIdType[],
      curr: AgentDataSourceConfigurationType
    ) => {
      // First we need to get the workspaceId from the workspaceSId
      const workspace = workspaces.find((w) => w.sId === curr.workspaceId);
      if (!workspace) {
        throw new Error(
          "Can't create Datasources config for retrieval: Workspace not found"
        );
      }

      // Find an existing entry for this workspaceId
      const existingEntry: _DsNamesPerWorkspaceIdType | undefined = acc.find(
        (entry: _DsNamesPerWorkspaceIdType) =>
          entry.workspaceId === workspace.id
      );
      if (existingEntry) {
        // Append dataSourceName to existing entry
        existingEntry.dataSourceNames.push(curr.dataSourceId);
      } else {
        // Add a new entry for this workspaceId
        acc.push({
          workspaceId: workspace.id,
          dataSourceNames: [curr.dataSourceId],
        });
      }
      return acc;
    },
    []
  );

  // Then we get do one findAllQuery per workspaceId, in a Promise.all
  const getDataSourcesQueries = dsNamesPerWorkspaceId.map(
    ({ workspaceId, dataSourceNames }) => {
      return DataSource.findAll({
        where: {
          workspaceId,
          name: {
            [Op.in]: dataSourceNames,
          },
        },
      });
    }
  );
  const results = await Promise.all(getDataSourcesQueries);
  const dataSources = results.flat();

  const agentDataSourcesConfigRows: AgentDataSourceConfiguration[] =
    await Promise.all(
      dataSourcesConfig.map(async (dsConfig) => {
        const dataSource = dataSources.find(
          (ds) =>
            ds.name === dsConfig.dataSourceId &&
            ds.workspaceId ===
              workspaces.find((w) => w.sId === dsConfig.workspaceId)?.id
        );
        if (!dataSource) {
          throw new Error("DataSource not found");
        }
        return AgentDataSourceConfiguration.create(
          {
            dataSourceId: dataSource.id,
            tagsIn: dsConfig.filter.tags?.in,
            tagsNotIn: dsConfig.filter.tags?.not,
            parentsIn: dsConfig.filter.parents?.in,
            parentsNotIn: dsConfig.filter.parents?.not,
            retrievalConfigId: retrievalConfigId,
          },
          { transaction: t }
        );
      })
    );
  return agentDataSourcesConfigRows;
}
