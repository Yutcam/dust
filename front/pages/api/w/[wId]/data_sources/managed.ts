import { NextApiRequest, NextApiResponse } from "next";
import { P } from "pino";

import { getDataSources } from "@app/lib/api/data_sources";
import { Authenticator, getSession } from "@app/lib/auth";
import { connectorsClient } from "@app/lib/connectors_client";
import { DustAPI } from "@app/lib/dust_api";
import { DataSource, Key, Provider } from "@app/lib/models";
import { credentialsFromProviders } from "@app/lib/providers";
import { Err, Ok, Result } from "@app/lib/result";
import { new_id } from "@app/lib/utils";
import { apiError, withLogging } from "@app/logger/withlogging";
import { DataSourceType } from "@app/types/data_source";

export type GetDataSourcesResponseBody = {
  dataSources: Array<DataSourceType>;
};

async function handler(
  req: NextApiRequest,
  res: NextApiResponse<GetDataSourcesResponseBody>
): Promise<void> {
  const session = await getSession(req, res);
  const auth = await Authenticator.fromSession(
    session,
    req.query.wId as string
  );

  const owner = auth.workspace();
  if (!owner) {
    res.status(404).end();
    return;
  }

  let dataSources = await getDataSources(auth);

  switch (req.method) {
    case "POST":
      if (!auth.isBuilder()) {
        return apiError(req, res, {
          status_code: 401,
          api_error: {
            type: "app_auth_error",
            message:
              "Only the users that are `builders` for the current workspace can create a data source.",
          },
        });
      }

      const dataSourceName = "Slack (managed)";
      const dataSourceDescription = "Slack (managed)";
      const dataSourceProviderId = "openai";
      const dataSourceModelId = "text-embedding-ada-002";
      const dataSourceMaxChunkSize = 512;

      if (
        !req.body.nangoConnectionId ||
        typeof req.body.nangoConnectionId !== "string"
      ) {
        return apiError(req, res, {
          status_code: 400,
          api_error: {
            type: "invalid_request_error",
            message:
              "The request body is invalid, expects \
               { nangoConnectionId: string }.",
          },
        });
      }

      const dustProject = await DustAPI.createProject();
      if (dustProject.isErr()) {
        return apiError(req, res, {
          status_code: 500,
          api_error: {
            type: "internal_server_error",
            // I don't know if we want to forward the core error to the client. LMK during code review please.
            message: `Could not create the project. Reason: ${dustProject.error}`,
          },
        });
      }

      const [providers] = await Promise.all([
        Provider.findAll({
          where: {
            workspaceId: owner.id,
          },
        }),
      ]);
      let credentials = credentialsFromProviders(providers);

      const dustDataSource = await DustAPI.createDataSource(
        dustProject.value.project.project_id.toString(),
        {
          dataSourceId: dataSourceName,
          config: {
            provider_id: dataSourceProviderId,
            model_id: dataSourceModelId,
            splitter_id: "base_v0",
            max_chunk_size: dataSourceMaxChunkSize,
            use_cache: false,
          },
          credentials,
        }
      );

      if (dustDataSource.isErr()) {
        return apiError(req, res, {
          status_code: 500,
          api_error: {
            type: "data_source_error",
            message: `Could not create the data source. reason: ${dustDataSource.error}`,
          },
        });
      }

      const dataSource = await DataSource.create({
        name: dataSourceName,
        description: dataSourceDescription,
        //assuming managed data sources are always private for now
        visibility: "private",
        config: JSON.stringify(dustDataSource.value.data_source.config),
        dustAPIProjectId: dustProject.value.project.project_id.toString(),
        workspaceId: owner.id,
      });
      const systemAPIKeyRes = await getSystemApiKey(owner.id);
      if (systemAPIKeyRes.isErr()) {
        console.error(
          `Could not create the system API key: ${systemAPIKeyRes.error}`
        );
        return apiError(req, res, {
          status_code: 500,
          api_error: {
            type: "internal_server_error",
            message: "Could not create the system API key",
          },
        });
      }

      try {
        const connectorId = await connectorsClient.createSlackConnector.mutate({
          workspaceId: owner.id.toString(),
          APIKey: systemAPIKeyRes.value.secret,
          dataSourceName: dataSource.name,
          nangoConnectionId: req.body.nangoConnectionId,
        });
        dataSource.connectorId = connectorId;
        dataSource.connectorProvider = "slack";
        dataSource.save();

        // Trigger a temporal workflow to print the channels in the worker process.
        // Here for show casing only.
        connectorsClient.getChannelsViaTemporalShowCaseProcedure.query(
          connectorId
        );

        res.redirect(`/${owner.sId}/ds/${dataSource.name}`);
        return;
      } catch (err) {
        return apiError(req, res, {
          status_code: 500,
          api_error: {
            type: "internal_server_error",
            // Do we want to forward the message from the connector service here?
            // TRPC is logging it but we might want to share why with the user.
            message: "Failed to create the connector.",
          },
        });
      }

    default:
      return apiError(req, res, {
        status_code: 405,
        api_error: {
          type: "method_not_supported_error",
          message: "The method passed is not supported, GET is expected.",
        },
      });
  }
}

// Not sure where this should go.
// Lets find out at code review time.
async function getSystemApiKey(
  workspaceId: number
): Promise<Result<Key, Error>> {
  let key = await Key.findOne({
    where: {
      workspaceId,
      isSystem: true,
    },
  });
  if (!key) {
    let secret = `sk-${new_id().slice(0, 32)}`;
    key = await Key.create({
      workspaceId,
      isSystem: true,
      secret: secret,
      status: "active",
    });
  }
  if (!key) {
    return new Err(new Error("Failed to create system key"));
  }

  return new Ok(key);
}
export default withLogging(handler);
