/*!
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { CodeWhispererStreamingClient } from '../../../../shared/clients/codeWhispererChatStreamingClient'
import { AuthUtil } from '../../../../codewhisperer/util/authUtil'
import { ChatCommandOutput, ChatRequest, CodeWhispererStreaming } from '@amzn/codewhisperer-streaming'
import * as vscode from 'vscode'
import { ToolkitError } from '../../../../shared/errors'

export class ChatSession {
    private sessionId?: string
    private client: CodeWhispererStreaming | undefined
    public get sessionIdentifier(): string | undefined {
        return this.sessionId
    }

    public tokenSource!: vscode.CancellationTokenSource

    constructor() {
        this.createNewTokenSource()
    }

    createNewTokenSource() {
        this.tokenSource = new vscode.CancellationTokenSource()
    }

    async chat(chatRequest: ChatRequest): Promise<ChatCommandOutput> {
        if (AuthUtil.instance.isConnectionExpired()) {
            AuthUtil.instance.showReauthenticatePrompt()
            throw new ToolkitError(
                'Connection expired. To continue using CodeWhisperer, connect with AWS Builder ID or AWS IAM Identity center.'
            )
        }

        if (this.client === undefined) {
            this.client = await new CodeWhispererStreamingClient().createSdkClient()
        }

        if (this.sessionId !== undefined && chatRequest.conversationState !== undefined) {
            chatRequest.conversationState.conversationId = this.sessionId
        }

        const response = await this.client.chat(chatRequest)
        if (!response.chatResponse) {
            throw new ToolkitError(`Empty chat response. Session id: ${this.sessionId}`)
        }

        // read the first event to get conversation id.
        // this assumes that the metadataEvent is the first event in the response stream.
        for await (const event of response.chatResponse) {
            if (event.messageMetadataEvent !== undefined) {
                this.sessionId = event.messageMetadataEvent!.conversationId
            }
            break
        }

        return response
    }
}
