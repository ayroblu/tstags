import fs from 'fs'
import path from 'path'

import docopt from 'docopt'
import glob from 'glob'
import _ from 'lodash'
import ts from 'typescript'

var pkg = require('../package.json')

var USAGE = `\
${ pkg.name } v${ pkg.version }

Usage: tstags [options] [FILE]...

Options:
  -h, --help          show this help message and exit
  -v, --version       show version and exit
  -f, --file [-]      write output to specified file. If file is "-", output is written to standard out
  -R, --recursive     recurse into directories in the file list [default: false]
  --fields <fields>   include selected extension fields
  --list-kinds        list supported languages
  --sort              sort tags [default: false]
  --target <version>  targeting language version [default: ES6]
  --tag-relative      file paths should be relative to the directory containing the tag file [default: false]
`

const fields = {
[ts.SyntaxKind.PropertyDeclaration]             : ['p', 'property'],
[ts.SyntaxKind.MethodDeclaration]               : ['m', 'method'],
[ts.SyntaxKind.Constructor]          : ['m', 'method'],
[ts.SyntaxKind.GetAccessor]          : ['m', 'method'],
[ts.SyntaxKind.SetAccessor]          : ['m', 'method'],
[ts.SyntaxKind.VariableDeclaration]  : ['v', 'variable'],
[ts.SyntaxKind.FunctionDeclaration]  : ['f', 'function'],
[ts.SyntaxKind.ClassDeclaration]     : ['C', 'class'],
[ts.SyntaxKind.InterfaceDeclaration] : ['i', 'interface'],
[ts.SyntaxKind.TypeAliasDeclaration] : ['t', 'typealias'],
[ts.SyntaxKind.EnumDeclaration]      : ['e', 'enum'],
[ts.SyntaxKind.ModuleDeclaration]    : ['M', 'module'],
[ts.SyntaxKind.ImportDeclaration]    : ['I', 'import'],
} as const

const kinds = _.uniq(_.map(_.values(fields), value => value.join('  ')))
kinds.push('c  const')

var scriptTargets = {
    ES3: ts.ScriptTarget.ES3,
    ES5: ts.ScriptTarget.ES5,
    ES2016: ts.ScriptTarget.ES2016,
    Latest: ts.ScriptTarget.Latest,
}

interface TaggingOptions {
    languageVersion: ts.ScriptTarget
    fields: string
    tagRelative: boolean
}

interface TagHeader {
    header: string
    value: string
    help?: string
}

interface TagEntry {
    name?: string
    file?: string
    address?: string
    field?: string
    line?: number
}

class Tags {
    entries: TagEntry[]
    sort: boolean

    constructor(options?: { sort?: boolean }) {
        options = options || {}
        this.sort = options.sort || false
        this.entries = []
    }

    headers(): TagHeader[] {
        var sorted = this.sort ? '1' : '0'
        return [
            { header: '_TAG_FILE_FORMAT', value: '2', help: 'extended format; --format=1 will not append ;" to lines' },
            { header: '_TAG_FILE_SORTED', value: sorted, help: '0=unsorted, 1=sorted, 2=foldcase' },
            { header: '_TAG_PROGRAM_AUTHOR', value: 'Sviatoslav Abakumov', help: 'dust.harvesting@gmail.com' },
            { header: '_TAG_PROGRAM_NAME', value: 'tstags' },
            { header: '_TAG_PROGRAM_URL', value: 'https://github.com/Perlence/tstags' },
            { header: '_TAG_PROGRAM_VERSION', value: '0.1' },
        ]
    }

    toString(): string {
        return this.writeHeaders().concat(this.writeEntries()).join('\n')
    }

    protected writeHeaders(): string[] {
        return this.headers().map(header =>
            `!${ header.header }\t${ header.value }\t${ header.help || '' }`
        )
    }

    protected writeEntries(): string[] {
        var sorted = this.entries
        if (this.sort)
            sorted = _.sortBy(this.entries, 'name')
        return sorted.map(entry =>
            `${ entry.name }\t${ entry.file }\t${ entry.address };"\t${ entry.field }\tline:${ entry.line }`
        )
    }
}

export function main() {
    var args = docopt.docopt(USAGE, { version: pkg.version })
    if (args['--version']) {
        console.log(pkg.version)
        process.exit(0)
    }
    if (args['--list-kinds']) {
        console.log(kinds.join('\n'))
        process.exit(0)
    }
    // List of files must be given.
    if (!args['FILE'].length) {
        console.log(USAGE)
        process.exit(1)
    }

    var names = args['FILE']
    var filenames: string[]
    if (args['--recursive']) {
        // Get all *.ts files recursively in given directories.
        filenames = _(names)
            .map(dir => glob.sync(path.join(dir, '**', '*.ts?(x)')))
            .flatten()
            .value()
    }
    else {
        filenames = names
    }

    var languageVersion = scriptTargets[args['--target'] as keyof typeof scriptTargets]
    if (languageVersion == null) {
        console.error('Unsupported language version: ' + args['--target'])
        process.exit(1)
    }

    var tags = new Tags({ sort: args['--sort'] })
    filenames.forEach(filename => {
        var text = fs.readFileSync(filename)
        var source = ts.createSourceFile(filename, text.toString(), languageVersion, false)

        makeTags(tags, source, {
            languageVersion: languageVersion,
            fields: args['--fields'],
            tagRelative: args['--tag-relative'],
        })
    })

    if (!tags.entries.length)
        process.exit(0)

    if (args['--file'] === '-') {
        console.log(tags.toString())
    }
    else {
        var filename = args['--file'] || 'tags'
        fs.writeFileSync(filename, tags.toString())
    }
}

function makeTags(tags: Tags, source: ts.SourceFile, options: TaggingOptions) {
    // options = options || {}

    var scanner = ts.createScanner(options.languageVersion, /* skipTrivia */ true, source.languageVariant, source.text)
    var lines = splitLines(source.text)
    makeTag(source, undefined)

    function makeTag(node: ts.Node, parent?: ts.Node) {
        var entry: TagEntry = {}
        var newParent = parent

        switch (node.kind) {
        case ts.SyntaxKind.Constructor:
            entry.name = 'constructor'
            break
        case ts.SyntaxKind.ModuleDeclaration:
        case ts.SyntaxKind.ClassDeclaration:
        case ts.SyntaxKind.InterfaceDeclaration:
            newParent = node
            break
        case ts.SyntaxKind.VariableDeclaration:
            //if (node.type != null && node.type.kind == ts.SyntaxKind.TypeLiteral)
            //    newParent = node
            if (node.flags & ts.NodeFlags.Const)
                entry.field = 'c'
            break
        }

        var field = fields[node.kind as keyof typeof fields]
        if (field != null && (options.fields == null || options.fields.indexOf(field[0]) >= 0)) {
            entry.field = entry.field || field[0]
            entry.name = entry.name || node.getText()
            // Prepend module name to all first-level declarations and
            // prepend class/interface name only to methods and
            // properties.
            if (parent != null &&
                    (parent.kind == ts.SyntaxKind.ModuleDeclaration ||
                     node.kind != ts.SyntaxKind.VariableDeclaration))
                entry.name = parent.getText() + '#' + entry.name
            entry.file = (options.tagRelative == true ?
                          source.fileName :
                          path.resolve(source.fileName))

            var firstLine = extractLine(source.text, node.pos, node.end)
            entry.address = `/^${ firstLine.text }$/`
            entry.line = firstLine.line

            tags.entries.push(entry)
        }

        ts.forEachChild(node, (node) => makeTag(node, newParent))
    }

    function extractLine(text: string, pos: number, end: number): { line: number; text: string } {
        scanner.setTextPos(pos)
        scanner.scan()
        var tokenPos = scanner.getTokenPos()
        var line = ts.positionToLineAndCharacter(text, tokenPos).line
        return {
            line: line,
            text: escapeStringRegexp(lines[line - 1]),
        }
    }
}

var matchOperatorsRe = /[\/^$]/g;

function escapeStringRegexp(str: string) {
    return str.replace(matchOperatorsRe,  '\\$&');
}

var endingsRe = /(?:\r\n|\r|\n)/

function splitLines(str: string) {
    return str.split(endingsRe)
}

if (require.main === module)
    main()
