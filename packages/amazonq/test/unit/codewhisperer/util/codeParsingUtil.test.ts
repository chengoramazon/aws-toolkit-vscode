/*!
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import {
    PlatformLanguageId,
    extractClasses,
    extractFunctions,
    isTestFile,
    utgLanguageConfigs,
} from 'aws-core-vscode/codewhisperer'
import assert from 'assert'
import { createTestWorkspaceFolder, toTextDocument } from 'aws-core-vscode/test'

describe('RegexValidationForPython', () => {
    it('should extract all function names from a python file content', () => {
        // TODO: Replace this variable based testing to read content from File.
        // const filePath = vscode.Uri.file('./testData/samplePython.py').fsPath;
        // const fileContent = fs.readFileSync('./testData/samplePython.py' , 'utf-8');
        // const regex = /function\s+(\w+)/g;

        const result = extractFunctions(pythonFileContent, utgLanguageConfigs['python'].functionExtractionPattern)
        assert.strictEqual(result.length, 13)
        assert.deepStrictEqual(result, [
            'hello_world',
            'add_numbers',
            'multiply_numbers',
            'sum_numbers',
            'divide_numbers',
            '__init__',
            'add',
            'multiply',
            'square',
            'from_sum',
            '__init__',
            'triple',
            'main',
        ])
    })

    it('should extract all class names from a file content', () => {
        const result = extractClasses(pythonFileContent, utgLanguageConfigs['python'].classExtractionPattern)
        assert.deepStrictEqual(result, ['Calculator'])
    })
})

describe('RegexValidationForJava', () => {
    it('should extract all function names from a java file content', () => {
        // TODO: Replace this variable based testing to read content from File.
        // const filePath = vscode.Uri.file('./testData/samplePython.py').fsPath;
        // const fileContent = fs.readFileSync('./testData/samplePython.py' , 'utf-8');
        // const regex = /function\s+(\w+)/g;

        const result = extractFunctions(javaFileContent, utgLanguageConfigs['java'].functionExtractionPattern)
        assert.strictEqual(result.length, 5)
        assert.deepStrictEqual(result, ['sayHello', 'doSomething', 'square', 'manager', 'ABCFUNCTION'])
    })

    it('should extract all class names from a java file content', () => {
        const result = extractClasses(javaFileContent, utgLanguageConfigs['java'].classExtractionPattern)
        assert.deepStrictEqual(result, ['Test'])
    })
})

describe('isTestFile', () => {
    let testWsFolder: string
    beforeEach(async function () {
        testWsFolder = (await createTestWorkspaceFolder()).uri.fsPath
    })

    it('validate by file path', async function () {
        const langs = new Map<string, string>([
            ['java', '.java'],
            ['python', '.py'],
            ['typescript', '.ts'],
            ['javascript', '.js'],
            ['typescriptreact', '.tsx'],
            ['javascriptreact', '.jsx'],
        ])
        const testFilePathsWithoutExt = [
            '/test/MyClass',
            '/test/my_class',
            '/tst/MyClass',
            '/tst/my_class',
            '/tests/MyClass',
            '/tests/my_class',
        ]

        const srcFilePathsWithoutExt = [
            '/src/MyClass',
            'MyClass',
            'foo/bar/MyClass',
            'foo/my_class',
            'my_class',
            'anyFolderOtherThanTest/foo/myClass',
        ]

        for (const [languageId, ext] of langs) {
            const testFilePaths = testFilePathsWithoutExt.map((it) => it + ext)
            for (const testFilePath of testFilePaths) {
                const actual = await isTestFile(testFilePath, { languageId: languageId })
                assert.strictEqual(actual, true)
            }

            const srcFilePaths = srcFilePathsWithoutExt.map((it) => it + ext)
            for (const srcFilePath of srcFilePaths) {
                const actual = await isTestFile(srcFilePath, { languageId: languageId })
                assert.strictEqual(actual, false)
            }
        }
    })

    async function assertIsTestFile(
        fileNames: string[],
        config: { languageId: PlatformLanguageId },
        expected: boolean
    ) {
        for (const fileName of fileNames) {
            const document = await toTextDocument('', fileName, testWsFolder)
            const actual = await isTestFile(document.uri.fsPath, { languageId: config.languageId })
            assert.strictEqual(actual, expected)
        }
    }

    it('validate by file name', async function () {
        const camelCaseSrc = ['Foo.java', 'Bar.java', 'Baz.java']
        await assertIsTestFile(camelCaseSrc, { languageId: 'java' }, false)

        const camelCaseTst = ['FooTest.java', 'BarTests.java']
        await assertIsTestFile(camelCaseTst, { languageId: 'java' }, true)

        const snakeCaseSrc = ['foo.py', 'bar.py']
        await assertIsTestFile(snakeCaseSrc, { languageId: 'python' }, false)

        const snakeCaseTst = ['test_foo.py', 'bar_test.py']
        await assertIsTestFile(snakeCaseTst, { languageId: 'python' }, true)

        const javascriptSrc = ['Foo.js', 'bar.js']
        await assertIsTestFile(javascriptSrc, { languageId: 'javascript' }, false)

        const javascriptTst = ['Foo.test.js', 'Bar.spec.js']
        await assertIsTestFile(javascriptTst, { languageId: 'javascript' }, true)

        const typescriptSrc = ['Foo.ts', 'bar.ts']
        await assertIsTestFile(typescriptSrc, { languageId: 'typescript' }, false)

        const typescriptTst = ['Foo.test.ts', 'Bar.spec.ts']
        await assertIsTestFile(typescriptTst, { languageId: 'typescript' }, true)

        const jsxSrc = ['Foo.jsx', 'Bar.jsx']
        await assertIsTestFile(jsxSrc, { languageId: 'javascriptreact' }, false)

        const jsxTst = ['Foo.test.jsx', 'Bar.spec.jsx']
        await assertIsTestFile(jsxTst, { languageId: 'javascriptreact' }, true)
    })

    it('should return true if the file name matches the test filename pattern - Java', async () => {
        const filePaths = ['/path/to/MyClassTest.java', '/path/to/TestMyClass.java', '/path/to/MyClassTests.java']
        const language = 'java'

        for (const filePath of filePaths) {
            const result = await isTestFile(filePath, { languageId: language })
            assert.strictEqual(result, true)
        }
    })

    it('should return false if the file name does not match the test filename pattern - Java', async () => {
        const filePaths = ['/path/to/MyClass.java', '/path/to/MyClass_test.java', '/path/to/test_MyClass.java']
        const language = 'java'

        for (const filePath of filePaths) {
            const result = await isTestFile(filePath, { languageId: language })
            assert.strictEqual(result, false)
        }
    })

    it('should return true if the file name does not match the test filename pattern - Python', async () => {
        const filePaths = ['/path/to/util_test.py', '/path/to/test_util.py']
        const language = 'python'

        for (const filePath of filePaths) {
            const result = await isTestFile(filePath, { languageId: language })
            assert.strictEqual(result, true)
        }
    })

    it('should return false if the file name does not match the test filename pattern - Python', async () => {
        const filePaths = ['/path/to/util.py', '/path/to/utilTest.java', '/path/to/Testutil.java']
        const language = 'python'

        for (const filePath of filePaths) {
            const result = await isTestFile(filePath, { languageId: language })
            assert.strictEqual(result, false)
        }
    })

    it('should return false if the language is not supported', async () => {
        const filePath = '/path/to/MyClass.cpp'
        const language = 'c++'
        const result = await isTestFile(filePath, { languageId: language })
        assert.strictEqual(result, false)
    })
})

const pythonFileContent = `
# Single-line import statements
import os
import numpy as np
from typing import List, Tuple

# Multi-line import statements
from collections import (
    defaultdict,
    Counter
)

# Relative imports
from . import module1
from ..subpackage import module2

# Wildcard imports
from mypackage import *
from mypackage.module import *

# Aliased imports
import pandas as pd
from mypackage import module1 as m1, module2 as m2

def hello_world():
    print("Hello, world!")

def add_numbers(x, y):
    return x + y

def multiply_numbers(x=1, y=1):
    return x * y

def sum_numbers(*args):
    total = 0
    for num in args:
        total += num
    return total

def divide_numbers(x, y=1, *args, **kwargs):
    result = x / y
    for arg in args:
        result /= arg
    for _, value in kwargs.items():
        result /= value
    return result

class Calculator:
    def __init__(self, x, y):
        self.x = x
        self.y = y
        
    def add(self):
        return self.x + self.y
    
    def multiply(self):
        return self.x * self.y
    
    @staticmethod
    def square(x):
        return x ** 2
    
    @classmethod
    def from_sum(cls, x, y):
        return cls(x+y, 0)
    
    class InnerClass:
        def __init__(self, z):
            self.z = z
            
        def triple(self):
            return self.z * 3
    
def main():
    print(hello_world())
    print(add_numbers(3, 5))
    print(multiply_numbers(3, 5))
    print(sum_numbers(1, 2, 3, 4, 5))
    print(divide_numbers(10, 2, 5, 2, a=2, b=3))
    
    calc = Calculator(3, 5)
    print(calc.add())
    print(calc.multiply())
    print(Calculator.square(3))
    print(Calculator.from_sum(2, 3).add())
    
    inner = Calculator.InnerClass(5)
    print(inner.triple())

if __name__ == "__main__":
    main()
`

const javaFileContent = `
@Annotation
public class Test {
    Test() {
        // Do something here
    }

    //Additional commenting
    public static void sayHello() {
        System.out.println("Hello, World!");
    }

    private void doSomething(int x, int y) throws Exception {
        int z = x + y;
        System.out.println("The sum of " + x + " and " + y + " is " + z);
    }

    protected static int square(int x) {
        return x * x;
    }

    private static void manager(int a, int b) {
        return a+b;
    }

    public int ABCFUNCTION( int ABC, int PQR) {
        return ABC + PQR;
    }
}`
