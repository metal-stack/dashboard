//
// SPDX-FileCopyrightText: 2024 SAP SE or an SAP affiliate company and Gardener contributors
//
// SPDX-License-Identifier: Apache-2.0
//

import { EditorView } from '@codemirror/view'
import { indentUnit } from '@codemirror/language'

import { useLogger } from '@/composables/useLogger'

import {
  trim,
  nth,
  filter,
  includes,
  last,
  words,
  repeat,
  upperFirst,
  flatMap,
  get,
  unset,
  forIn,
  isEqual,
  first,
} from '@/lodash'

export async function createEditor (...args) {
  return new EditorView(...args)
}

export class EditorCompletions {
  constructor (shootProperties, options = {}) {
    const {
      cmView,
      supportedPaths = [],
      logger = useLogger(),
    } = options

    this.#resolveSchemaArrays(shootProperties)
    this.shootCompletions = shootProperties

    this.logger = logger
    this.indentUnit = cmView.state.facet(indentUnit).length
    this.arrayBulletIndent = 2 // -[space]
    this.supportedPaths = supportedPaths
  }

  // Callback function for CodeMirror autocomplete plugin
  yamlHint (context) {
    const cmView = context.view
    const word = context.matchBefore(/\w*/)

    const cursor = this.#getCursor(cmView)
    const token = this.#getYamlToken(cmView, cursor)

    const lineString = cmView.state.doc.line(cursor.line).text

    const lineContainsKeyValuePair = /\w:\s/.test(lineString)
    let list = []
    if (!lineContainsKeyValuePair) {
      list = this.#getYamlCompletions(token, cursor, cmView)
    }

    return {
      options: list,
      from: word.from,
      to: word.to,
      filter: false,
    }
  }

  // Callback function for CodeMirror tooltip
  editorTooltip (e, cmView) {
    const pos = cmView.posAtCoords({ x: e.clientX, y: e.clientY })
    const line = cmView.state.doc.lineAt(pos).number
    const lineChar = pos - cmView.state.doc.line(line).from

    const lineString = cmView.state.doc.line(line).text
    const result = lineString.match(/^(\s*-?\s*)([^\s]+?):.*$/)

    if (result) {
      const [, indent, tokenString] = result
      const start = indent.length
      const end = start + tokenString.length
      const string = tokenString.toLowerCase()
      const token = {
        start,
        end,
        string,
      }
      if (token.start <= lineChar && lineChar <= token.end) {
        // Ensure that mouse pointer is on property and not somewhere else on this line
        const cursor = { ch: lineChar, line }
        const completions = this.#getYamlCompletions(token, cursor, cmView, true)
        if (completions.length === 1) {
          return first(completions)
        }
      }
    }
  }

  // callback function for cm editor enter function
  editorEnter (cmView) {
    const cursor = this.#getCursor(cmView)

    const lineString = cmView.state.doc.line(cursor.line).text
    const [, indent, firstArrayItem] = lineString.match(/^(\s*)(-\s)?(.*)$/) || []

    let extraIntent = ''
    if (firstArrayItem) {
      extraIntent = `${repeat(' ', this.arrayBulletIndent)}`
    } else if (this.#isLineStartingObject(lineString)) {
      extraIntent = `${repeat(' ', this.indentUnit)}`
    }
    this.#replaceSelection(cmView, `\n${indent}${extraIntent}`)
  }

  // Get completions for token, exact match is used for tooltip function
  #getYamlCompletions (token, cursor, cmView, exactMatch = false) {
    const completionPath = this.#getTokenCompletionPath(token, cursor, cmView)
    if (this.supportedPaths?.length) {
      const cursorrentPath = completionPath.join('.')
      if (!this.supportedPaths.some(path => cursorrentPath.startsWith(path))) {
        return []
      }
    }

    let completions
    if (completionPath.length > 0) {
      completions = get(this.shootCompletions, completionPath)
    } else {
      completions = this.shootCompletions
    }

    let completionArray = []
    const generateCompletionText = (propertyName, yamlType, tokenType) => {
      const numberOfSpaces = token.start + this.indentUnit + (tokenType === 'firstArrayItem' ? this.arrayBulletIndent : 0)
      const completionIndentStr = repeat(' ', numberOfSpaces)
      if (yamlType === 'array') {
        return `${propertyName}:\n${completionIndentStr}- `
      }
      if (yamlType === 'object') {
        return `${propertyName}:\n${completionIndentStr}`
      }
      return `${propertyName}: `
    }

    const generateTypeText = (type, format) => {
      const formatTypeText = (type, format) => {
        return format ? `${upperFirst(type)} (${format})` : upperFirst(type)
      }
      if (Array.isArray(type)) {
        return type
          .map((type, i) => formatTypeText(type, format[i])) // eslint-disable-line security/detect-object-injection
          .join(' | ')
      }
      return formatTypeText(type, format)
    }

    forIn(completions, (completion, propertyName) => {
      const text = generateCompletionText(propertyName, completion.type, token.type)
      const string = propertyName.toLowerCase()
      const typeText = generateTypeText(completion.type, completion.format)

      completionArray.push({
        label: string,
        displayLabel: text,
        detail: typeText,
        type: 'keyword',
        info: completion.description,
        apply: text,
        property: propertyName,
      })
    })

    if (trim(token.string).length > 0) {
      completionArray = filter(completionArray, completion => {
        let tokenString = token.string
        if (token.type === 'firstArrayItem') {
          tokenString = tokenString.replace(/.*\s-\s/, '')
        }
        if (exactMatch) {
          return isEqual(completion.label, tokenString)
        }
        // filter completions that to not match text already in line
        return includes(completion.label, tokenString)
      })
    }

    return completionArray
  }

  // get token at cursorsor position in editor with yaml content
  #getYamlToken (cmView, cursor) {
    let token
    const lineString = cmView.state.doc.line(cursor.line).text

    const result = lineString.match(/^(\s*)-\s(.*)$/)
    if (result) {
      const indent = result[1]
      token = { string: lineString }
      token.type = 'firstArrayItem'
      token.indent = token.start = indent.length
      token.end = token.start + token.string.length + this.arrayBulletIndent
      token.propertyName = trim(token.string)

      const objectToken = this.#returnObjectTokenFromLine(lineString)
      if (objectToken) {
        // firstArrayItem line can also start new object
        token.propertyName = objectToken.propertyName
      }
    }
    if (!token) {
      token = this.#returnObjectTokenFromLine(lineString)
    }
    if (!token) {
      const string = this.#getTokenStringFromLine(lineString, cursor.ch)
      token = {
        string,
        start: cursor.ch - string.length,
        end: cursor.ch,
      }
    }

    return token
  }

  // returns path to completions in shootCompletions object
  #getTokenCompletionPath (token, cursor, cmView) {
    let currentToken = token
    let line = cursor.line
    const tokenContext = []
    while (line >= 1 && !this.#isTopLevelProperty(currentToken)) {
      currentToken = this.#getYamlToken(cmView, { line, ch: 0 })
      if (this.#isCurrentTokenParentOfToken(currentToken, token) &&
        this.#isCurrentTokenIndentSmallerThanContextRoot(currentToken, tokenContext)) {
        if (currentToken.type === 'property') {
          tokenContext.unshift(currentToken)
        } else if (currentToken.type === 'firstArrayItem') {
          tokenContext.unshift(currentToken)
        }
      }
      line--
    }

    // token context contains all parent tokens of `token, except for the token itself
    const tokenPath = flatMap(tokenContext, (pathToken, index, tokenContext) => {
      const isLeafContextToken = pathToken === last(tokenContext)
      switch (pathToken.type) {
        case 'property': {
          const nextToken = nth(tokenContext, index + 1)
          if (nextToken && nextToken.type === 'firstArrayItem') {
            // next item is array, so don't append 'properties' to path
            return pathToken.propertyName
          }
          if (isLeafContextToken && token.type === 'firstArrayItem') {
            // leaf context token is array, so list properties of its items
            return [pathToken.propertyName, 'items', 'properties']
          }
          // regular property token
          return [pathToken.propertyName, 'properties']
        }
        case 'firstArrayItem': {
          const isTokenIndentIndicatingObjectStart = token.start === pathToken.indent + this.indentUnit + this.arrayBulletIndent
          if (pathToken.propertyName !== undefined && isLeafContextToken && isTokenIndentIndicatingObjectStart) {
            // firstArrayItem line can also start new object, so list properties of item object
            return ['items', 'properties', pathToken.propertyName, 'properties']
          }
          // path token is array, so list properties of its items
          return ['items', 'properties']
        }
      }
      return []
    })

    return tokenPath
  }

  // Utils
  #isTopLevelProperty (token) {
    return token.type === 'property' && token.indent === 0
  }

  #isCurrentTokenParentOfToken (currentToken, token) {
    return currentToken.indent < token.start
  }

  #isContextInitial (context) {
    return context.length === 0
  }

  #isCurrentTokenIndentSmallerThanContextRoot (currentToken, context) {
    return this.#isContextInitial(context) || first(context).indent > currentToken.indent
  }

  #getTokenStringFromLine (lineString, cursorsorChar) {
    return trim(last(words(lineString.substring(0, cursorsorChar).toLowerCase())))
  }

  #isLineStartingObject (lineString) {
    return lineString.endsWith(':')
  }

  #returnObjectTokenFromLine (lineString) {
    if (!this.#isLineStartingObject(lineString)) {
      return
    }

    const [, indent, propertyName] = lineString.match(/^(\s*)(?:-\s)?(.+?):$/)
    const token = { string: lineString }
    token.indent = token.start = indent.length
    token.propertyName = propertyName
    token.type = 'property'

    return token
  }

  #resolveSchemaArrays (properties, parentPropertyName = '') {
    const hasValidKeys = value => {
      const validKeyCombinations = [
        ['type'],
        ['type', 'format'],
      ]

      return value.every(item => {
        const keys = Object.keys(item)
        return validKeyCombinations.some(combination =>
          combination.length === keys.length && combination.every(key => keys.includes(key)),
        )
      })
    }
    let foundDiscriminators = false
    for (const [propertyName, propertyValue] of Object.entries(properties)) {
      if (['allOf', 'anyOf', 'oneOf'].includes(propertyName) && !properties.type) {
        if (foundDiscriminators) {
          // We cursorrently do not support merging when schema has multiple discriminators on same level
          this.logger.warn('Found multiple discriminators in schema at %s', parentPropertyName)
        }
        foundDiscriminators = true

        if (propertyValue.length === 1) {
          this.#resolveSchemaArrays(propertyValue[0], parentPropertyName)
          Object.assign(properties, propertyValue[0])
        } else if (propertyValue.length > 1 && propertyName === 'oneOf') {
          if (hasValidKeys(propertyValue)) {
            // In case of oneOf, we support multiple entries if they are only used to define different types
            properties.type = propertyValue.map(obj => obj.type)
            properties.format = propertyValue.map(obj => obj.format)
          } else {
            this.logger.warn('Found unsupported oneOf discriminator at %s', parentPropertyName)
          }
        } else {
          this.logger.warn('Unsupported schema array length, %s has length %i at %s', propertyName, propertyValue.length, parentPropertyName)
        }

        unset(properties, [propertyName])
      } else if (typeof propertyValue === 'object') {
        this.#resolveSchemaArrays(propertyValue, propertyName)
      }
    }
  }

  #getCursor (cmView) {
    const selection = cmView.state.selection.main
    const line = cmView.state.doc.lineAt(selection.head).number
    const ch = selection.head - cmView.state.doc.line(line).from
    return { line, ch }
  }

  #replaceSelection (cmView, replacementText) {
    const selection = cmView.state.selection.main
    const newCursorPosition = selection.from + replacementText.length
    cmView.dispatch({
      changes: { from: selection.from, to: selection.to, insert: replacementText },
      selection: { anchor: newCursorPosition },
      effects: EditorView.scrollIntoView(newCursorPosition),
    })
  }
}
