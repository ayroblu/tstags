"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
var _a;
Object.defineProperty(exports, "__esModule", { value: true });
var fs_1 = __importDefault(require("fs"));
var path_1 = __importDefault(require("path"));
var docopt_1 = __importDefault(require("docopt"));
var glob_1 = __importDefault(require("glob"));
var lodash_1 = __importDefault(require("lodash"));
var typescript_1 = __importDefault(require("typescript"));
var pkg = require('../package.json');
var USAGE = pkg.name + " v" + pkg.version + "\n\nUsage: tstags [options] [FILE]...\n\nOptions:\n  -h, --help          show this help message and exit\n  -v, --version       show version and exit\n  -f, --file [-]      write output to specified file. If file is \"-\", output is written to standard out\n  -R, --recursive     recurse into directories in the file list [default: false]\n  --fields <fields>   include selected extension fields\n  --list-kinds        list supported languages\n  --sort              sort tags [default: false]\n  --target <version>  targeting language version [default: ES6]\n  --tag-relative      file paths should be relative to the directory containing the tag file [default: false]\n";
var fields = (_a = {},
    _a[typescript_1.default.SyntaxKind.PropertyDeclaration] = ['p', 'property'],
    _a[typescript_1.default.SyntaxKind.MethodDeclaration] = ['m', 'method'],
    _a[typescript_1.default.SyntaxKind.Constructor] = ['m', 'method'],
    _a[typescript_1.default.SyntaxKind.GetAccessor] = ['m', 'method'],
    _a[typescript_1.default.SyntaxKind.SetAccessor] = ['m', 'method'],
    _a[typescript_1.default.SyntaxKind.VariableDeclaration] = ['v', 'variable'],
    _a[typescript_1.default.SyntaxKind.FunctionDeclaration] = ['f', 'function'],
    _a[typescript_1.default.SyntaxKind.ClassDeclaration] = ['C', 'class'],
    _a[typescript_1.default.SyntaxKind.InterfaceDeclaration] = ['i', 'interface'],
    _a[typescript_1.default.SyntaxKind.TypeAliasDeclaration] = ['t', 'typealias'],
    _a[typescript_1.default.SyntaxKind.EnumDeclaration] = ['e', 'enum'],
    _a[typescript_1.default.SyntaxKind.ModuleDeclaration] = ['M', 'module'],
    _a[typescript_1.default.SyntaxKind.ImportDeclaration] = ['I', 'import'],
    _a);
var kinds = lodash_1.default.uniq(lodash_1.default.map(lodash_1.default.values(fields), function (value) { return value.join('  '); }));
kinds.push('c  const');
var scriptTargets = {
    ES3: typescript_1.default.ScriptTarget.ES3,
    ES5: typescript_1.default.ScriptTarget.ES5,
    ES2016: typescript_1.default.ScriptTarget.ES2016,
    Latest: typescript_1.default.ScriptTarget.Latest,
};
var Tags = /** @class */ (function () {
    function Tags(options) {
        options = options || {};
        this.sort = options.sort || false;
        this.entries = [];
    }
    Tags.prototype.headers = function () {
        var sorted = this.sort ? '1' : '0';
        return [
            { header: '_TAG_FILE_FORMAT', value: '2', help: 'extended format; --format=1 will not append ;" to lines' },
            { header: '_TAG_FILE_SORTED', value: sorted, help: '0=unsorted, 1=sorted, 2=foldcase' },
            { header: '_TAG_PROGRAM_AUTHOR', value: 'Sviatoslav Abakumov', help: 'dust.harvesting@gmail.com' },
            { header: '_TAG_PROGRAM_NAME', value: 'tstags' },
            { header: '_TAG_PROGRAM_URL', value: 'https://github.com/Perlence/tstags' },
            { header: '_TAG_PROGRAM_VERSION', value: '0.1' },
        ];
    };
    Tags.prototype.toString = function () {
        return this.writeHeaders().concat(this.writeEntries()).join('\n');
    };
    Tags.prototype.writeHeaders = function () {
        return this.headers().map(function (header) {
            return "!" + header.header + "\t" + header.value + "\t" + (header.help || '');
        });
    };
    Tags.prototype.writeEntries = function () {
        var sorted = this.entries;
        if (this.sort)
            sorted = lodash_1.default.sortBy(this.entries, 'name');
        return sorted.map(function (entry) {
            return entry.name + "\t" + entry.file + "\t" + entry.address + ";\"\t" + entry.field + "\tline:" + entry.line;
        });
    };
    return Tags;
}());
function main() {
    var args = docopt_1.default.docopt(USAGE, { version: pkg.version });
    if (args['--version']) {
        console.log(pkg.version);
        process.exit(0);
    }
    if (args['--list-kinds']) {
        console.log(kinds.join('\n'));
        process.exit(0);
    }
    // List of files must be given.
    if (!args['FILE'].length) {
        console.log(USAGE);
        process.exit(1);
    }
    var names = args['FILE'];
    var filenames;
    if (args['--recursive']) {
        // Get all *.ts files recursively in given directories.
        filenames = lodash_1.default(names)
            .map(function (dir) { return glob_1.default.sync(path_1.default.join(dir, '**', '*.ts?(x)')); })
            .flatten()
            .value();
    }
    else {
        filenames = names;
    }
    var languageVersion = scriptTargets[args['--target']];
    if (languageVersion == null) {
        console.error('Unsupported language version: ' + args['--target']);
        process.exit(1);
    }
    var tags = new Tags({ sort: args['--sort'] });
    filenames.forEach(function (filename) {
        var text = fs_1.default.readFileSync(filename);
        var source = typescript_1.default.createSourceFile(filename, text.toString(), languageVersion, false);
        makeTags(tags, source, {
            languageVersion: languageVersion,
            fields: args['--fields'],
            tagRelative: args['--tag-relative'],
        });
    });
    if (!tags.entries.length)
        process.exit(0);
    if (args['--file'] === '-') {
        console.log(tags.toString());
    }
    else {
        var filename = args['--file'] || 'tags';
        fs_1.default.writeFileSync(filename, tags.toString());
    }
}
exports.main = main;
function makeTags(tags, source, options) {
    // options = options || {}
    var scanner = typescript_1.default.createScanner(options.languageVersion, /* skipTrivia */ true, source.languageVariant, source.text);
    var lines = splitLines(source.text);
    makeTag(source, undefined);
    function makeTag(node, parent) {
        var entry = {};
        var newParent = parent;
        switch (node.kind) {
            case typescript_1.default.SyntaxKind.Constructor:
                entry.name = 'constructor';
                break;
            case typescript_1.default.SyntaxKind.ModuleDeclaration:
            case typescript_1.default.SyntaxKind.ClassDeclaration:
            case typescript_1.default.SyntaxKind.InterfaceDeclaration:
                newParent = node;
                break;
            case typescript_1.default.SyntaxKind.VariableDeclaration:
                //if (node.type != null && node.type.kind == ts.SyntaxKind.TypeLiteral)
                //    newParent = node
                if (node.flags & typescript_1.default.NodeFlags.Const)
                    entry.field = 'c';
                break;
        }
        var field = fields[node.kind];
        if (field != null && (options.fields == null || options.fields.indexOf(field[0]) >= 0)) {
            entry.field = entry.field || field[0];
            entry.name = entry.name || node.getText();
            // Prepend module name to all first-level declarations and
            // prepend class/interface name only to methods and
            // properties.
            if (parent != null &&
                (parent.kind == typescript_1.default.SyntaxKind.ModuleDeclaration ||
                    node.kind != typescript_1.default.SyntaxKind.VariableDeclaration))
                entry.name = parent.getText() + '#' + entry.name;
            entry.file = (options.tagRelative == true ?
                source.fileName :
                path_1.default.resolve(source.fileName));
            var firstLine = extractLine(source.text, node.pos, node.end);
            entry.address = "/^" + firstLine.text + "$/";
            entry.line = firstLine.line;
            tags.entries.push(entry);
        }
        typescript_1.default.forEachChild(node, function (node) { return makeTag(node, newParent); });
    }
    function extractLine(text, pos, end) {
        scanner.setTextPos(pos);
        scanner.scan();
        var tokenPos = scanner.getTokenPos();
        var line = typescript_1.default.positionToLineAndCharacter(text, tokenPos).line;
        return {
            line: line,
            text: escapeStringRegexp(lines[line - 1]),
        };
    }
}
var matchOperatorsRe = /[\/^$]/g;
function escapeStringRegexp(str) {
    return str.replace(matchOperatorsRe, '\\$&');
}
var endingsRe = /(?:\r\n|\r|\n)/;
function splitLines(str) {
    return str.split(endingsRe);
}
if (require.main === module)
    main();
