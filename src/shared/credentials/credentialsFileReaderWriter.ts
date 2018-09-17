/*!
 * Copyright 2018 Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

'use strict'

export interface CredentialsFileReaderWriter {
    // returns the list of available profile names
    getProfileNames(): Promise<string[]>

    // writes a new profile to the credential file
    addProfileToFile(profileName: string, accessKey: string, secretKet: string): Promise<void>

    /**
     * Gets the default region for a credentials profile
     * 
     * @param profileName Profile to get the default region from
     * @returns Default region, undefined if region is not set
     */
    getDefaultRegion(profileName: string): Promise<string | undefined>
}