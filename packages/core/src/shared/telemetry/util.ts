/*!
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import * as vscode from 'vscode'
import { env, Memento, version } from 'vscode'
import * as os from 'os'
import { getLogger } from '../logger'
import { fromExtensionManifest, migrateSetting, Settings } from '../settings'
import { memoize } from '../utilities/functionUtils'
import { isInDevEnv, extensionVersion, isAutomation, isRemoteWorkspace } from '../vscode/env'
import { addTypeName } from '../utilities/typeConstructors'
import globals, { isWeb } from '../extensionGlobals'
import { mapMetadata } from './telemetryLogger'
import { Result } from './telemetry.gen'
import { MetricDatum } from './clienttelemetry'
import { isValidationExemptMetric } from './exemptMetrics'
import { isAmazonQ, isCloud9, isSageMaker } from '../../shared/extensionUtilities'
import { isExtensionInstalled, VSCODE_EXTENSION_ID } from '../utilities'
import { randomUUID } from '../../common/crypto'
import { activateExtension } from '../utilities/vsCodeUtils'
import { ClassToInterfaceType } from '../utilities/tsUtils'

const legacySettingsTelemetryValueDisable = 'Disable'
const legacySettingsTelemetryValueEnable = 'Enable'

const TelemetryFlag = addTypeName('boolean', convertLegacy)
const telemetryClientIdGlobalStatekey = 'telemetryClientId'
const telemetryClientIdEnvKey = '__TELEMETRY_CLIENT_ID'

export class TelemetryConfig {
    private readonly amazonQSettingMigratedKey = 'amazonq.telemetry.migrated'
    private readonly _toolkitConfig
    private readonly _amazonQConfig

    public get toolkitConfig() {
        return this._toolkitConfig
    }

    public get amazonQConfig() {
        return this._amazonQConfig
    }

    constructor(settings?: ClassToInterfaceType<Settings>) {
        class ToolkitConfig extends fromExtensionManifest('aws', {
            telemetry: TelemetryFlag,
        }) {}

        class AmazonQConfig extends fromExtensionManifest('amazonQ', {
            telemetry: TelemetryFlag,
        }) {}

        this._toolkitConfig = new ToolkitConfig(settings)
        this._amazonQConfig = new AmazonQConfig(settings)
    }

    public isEnabled(): boolean {
        return (isAmazonQ() ? this.amazonQConfig : this.toolkitConfig).get(`telemetry`, true)
    }

    public async initAmazonQSetting() {
        if (!isAmazonQ() || globals.context.globalState.get<boolean>(this.amazonQSettingMigratedKey)) {
            return
        }
        // aws.telemetry isn't deprecated, we are just initializing amazonQ.telemetry with its value.
        // This is also why we need to check that we only try this migration once.
        await migrateSetting({ key: 'aws.telemetry', type: Boolean }, { key: 'amazonQ.telemetry' })
        await globals.context.globalState.update(this.amazonQSettingMigratedKey, true)
    }
}

export function convertLegacy(value: unknown): boolean {
    if (typeof value === 'boolean') {
        return value
    }

    // Set telemetry value to boolean if the current value matches the legacy value
    if (value === legacySettingsTelemetryValueDisable) {
        return false
    } else if (value === legacySettingsTelemetryValueEnable) {
        return true
    } else {
        throw new TypeError(`Unknown telemetry setting: ${value}`)
    }
}

export const getClientId = memoize(
    /**
     * @param nonce Dummy parameter to allow tests to defeat memoize().
     */
    (globalState: Memento, isTelemetryEnabled = new TelemetryConfig().isEnabled(), isTest?: false, nonce?: string) => {
        if (isTest ?? isAutomation()) {
            return 'ffffffff-ffff-ffff-ffff-ffffffffffff'
        }
        if (!isTelemetryEnabled) {
            return '11111111-1111-1111-1111-111111111111'
        }
        try {
            let clientId = globalState.get<string>(telemetryClientIdGlobalStatekey)
            if (!clientId) {
                clientId = randomUUID()
                globalState.update(telemetryClientIdGlobalStatekey, clientId).then(undefined, (e) => {
                    getLogger().error('getClientId: globalState.update failed: %O', e)
                })
            }
            return clientId
        } catch (e) {
            getLogger().error('getClientId: failed to create client id: %O', e)
            const clientId = '00000000-0000-0000-0000-000000000000'
            return clientId
        }
    }
)

export const platformPair = () => `${env.appName.replace(/\s/g, '-')}/${version}`

/**
 * Returns a string that should be used as the extension's user agent.
 *
 * Omits the platform and `ClientId` pairs by default.
 */
export function getUserAgent(
    opt?: { includePlatform?: boolean; includeClientId?: boolean },
    globalState = globals.context.globalState
): string {
    const pairs = isAmazonQ()
        ? [`AmazonQ-For-VSCode/${extensionVersion}`]
        : [`AWS-Toolkit-For-VSCode/${extensionVersion}`]

    if (opt?.includePlatform) {
        pairs.push(platformPair())
    }

    if (opt?.includeClientId) {
        const clientId = getClientId(globalState)
        pairs.push(`ClientId/${clientId}`)
    }

    return pairs.join(' ')
}

type EnvType =
    | 'cloud9'
    | 'cloud9-codecatalyst'
    | 'codecatalyst'
    | 'local'
    | 'ec2'
    | 'sagemaker'
    | 'test'
    | 'wsl'
    | 'unknown'

export function getComputeEnvType(): EnvType {
    if (isCloud9('classic')) {
        return 'cloud9'
    } else if (isCloud9('codecatalyst')) {
        return 'cloud9-codecatalyst'
    } else if (isInDevEnv()) {
        return 'codecatalyst'
    } else if (isSageMaker()) {
        return 'sagemaker'
    } else if (isRemoteWorkspace() && !isInDevEnv()) {
        return 'ec2'
    } else if (env.remoteName) {
        return 'wsl'
    } else if (isAutomation()) {
        return 'test'
    } else if (!env.remoteName) {
        return 'local'
    } else {
        return 'unknown'
    }
}

/**
 * Validates that emitted telemetry metrics
 * 1. contain a result property and
 * 2. contain a reason propery if result = 'Failed'.
 */
export function validateMetricEvent(event: MetricDatum, fatal: boolean) {
    const failedStr: Result = 'Failed'
    const telemetryRunDocsStr =
        ' Consider using `.run()` instead of `.emit()`, which will set these properties automatically. ' +
        'See https://github.com/aws/aws-toolkit-vscode/blob/master/docs/telemetry.md#guidelines'

    if (!isValidationExemptMetric(event.MetricName) && event.Metadata) {
        const metadata = mapMetadata([])(event.Metadata)
        let msg = 'telemetry: invalid Metric: '

        if (metadata.result === undefined) {
            msg += `"${event.MetricName}" emitted without the \`result\` property, which is always required.`
        } else if (metadata.result === failedStr && metadata.reason === undefined) {
            msg += `"${event.MetricName}" emitted with result=Failed but without the \`reason\` property.`
        } else {
            return // Validation passed.
        }

        msg += telemetryRunDocsStr
        if (fatal) {
            throw new Error(msg)
        }
        getLogger().warn(msg)
    }
}

/**
 * Setup the telemetry client id at extension activation.
 * This function is designed to let AWS Toolkit and Amazon Q share
 * the same telemetry client id.
 */
export async function setupTelemetryId(extensionContext: vscode.ExtensionContext) {
    try {
        if (isWeb()) {
            await globals.context.globalState.update(telemetryClientIdGlobalStatekey, vscode.env.machineId)
        } else {
            const currentClientId = globals.context.globalState.get<string>(telemetryClientIdGlobalStatekey)
            const storedClientId = process.env[telemetryClientIdEnvKey]
            if (currentClientId && storedClientId) {
                if (extensionContext.extension.id === VSCODE_EXTENSION_ID.awstoolkit) {
                    getLogger().debug(`telemetry: Store telemetry client id to env ${currentClientId}`)
                    process.env[telemetryClientIdEnvKey] = currentClientId
                    // notify amazon q to use this stored client id
                    // if amazon q activates first. Do not block on activate amazon q
                    if (isExtensionInstalled(VSCODE_EXTENSION_ID.amazonq)) {
                        void activateExtension(VSCODE_EXTENSION_ID.amazonq).then(async () => {
                            getLogger().debug(`telemetry: notifying Amazon Q to adopt client id ${currentClientId}`)
                            await vscode.commands.executeCommand('aws.amazonq.setupTelemetryId')
                        })
                    }
                } else if (isAmazonQ()) {
                    getLogger().debug(`telemetry: Set telemetry client id to ${storedClientId}`)
                    await globals.context.globalState.update(telemetryClientIdGlobalStatekey, storedClientId)
                } else {
                    getLogger().error(`Unexpected extension id ${extensionContext.extension.id}`)
                }
            } else if (!currentClientId && storedClientId) {
                getLogger().debug(`telemetry: Write telemetry client id to global state ${storedClientId}`)
                await globals.context.globalState.update(telemetryClientIdGlobalStatekey, storedClientId)
            } else if (currentClientId && !storedClientId) {
                getLogger().debug(`telemetry: Write telemetry client id to env ${currentClientId}`)
                process.env[telemetryClientIdEnvKey] = currentClientId
            } else {
                const clientId = getClientId(globals.context.globalState)
                getLogger().debug(`telemetry: Setup telemetry client id ${clientId}`)
                process.env[telemetryClientIdEnvKey] = clientId
            }
        }
    } catch (err) {
        getLogger().error(`Error while setting up telemetry id ${err}`)
    }
}

/**
 * Potentially helpful values for the 'source' field in telemetry.
 */
export const ExtStartUpSources = {
    firstStartUp: 'firstStartUp',
    update: 'update',
    reload: 'reload',
    none: 'none',
} as const

export type ExtStartUpSource = (typeof ExtStartUpSources)[keyof typeof ExtStartUpSources]

/**
 * Useful for populating the sendTelemetryEvent request from codewhisperer's api for publishing custom telemetry events for AB Testing.
 *
 * Returns one of the enum values of OptOutPreferences model (see SendTelemetryRequest model in the codebase)
 */
export function getOptOutPreference() {
    return globals.telemetry.telemetryEnabled ? 'OPTIN' : 'OPTOUT'
}

/**
 * Useful for populating the sendTelemetryEvent request from codewhisperer's api for publishing custom telemetry events for AB Testing.
 *
 * Returns one of the enum values of the OperatingSystem model (see SendTelemetryRequest model in the codebase)
 */
export function getOperatingSystem(): 'MAC' | 'WINDOWS' | 'LINUX' {
    const osId = os.platform() // 'darwin', 'win32', 'linux', etc.
    if (osId === 'darwin') {
        return 'MAC'
    } else if (osId === 'win32') {
        return 'WINDOWS'
    } else {
        return 'LINUX'
    }
}
