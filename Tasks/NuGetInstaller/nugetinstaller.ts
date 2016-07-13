/// <reference path="../../definitions/node.d.ts"/>
/// <reference path="../../definitions/Q.d.ts" />
/// <reference path="../../definitions/vsts-task-lib.d.ts" />

import path = require('path');
import Q = require('q');
import tl = require('vsts-task-lib/task');
import helper = require('./vso-nuget-helper');

//read inputs
var solution = tl.getPathInput('solution', true, false);
var nugetConfigPath = tl.getPathInput('nugetConfigPath', false, true);
var noCache = tl.getBoolInput('noCache');
var nuGetRestoreArgs = tl.getInput('nuGetRestoreArgs');
var nuGetPath = tl.getPathInput('nuGetPath', false, true);

//find nuget location to use
var nuGetPathToUse = tl.which('nuget');
if(nuGetPath) {
    nuGetPathToUse = nuGetPath;
}
if(!nuGetPathToUse) {
    tl.error('Failed to find nuget.');
    tl.exit(1);
}
tl.checkPath(nuGetPathToUse, 'nuget');

//check if mono is available,
var monoPath = tl.which('mono');
if(!monoPath) {
    tl.error('Failed to find mono. Mono is required to run NuGet.exe on OSX and Linux.');
    tl.exit(1);
}

var sourcesFolder = tl.getVariable('system.defaultworkingdirectory');
var runnuget = function(fn) {
    return Q.fcall(() => {
        var nugetTool;
        if(nuGetPathToUse.trim().endsWith('.exe')) {
            nugetTool = tl.createToolRunner(monoPath);
            nugetTool.pathArg(nuGetPathToUse);
        } else {
            nugetTool = tl.createToolRunner(nuGetPathToUse);
        }

        nugetTool.arg('restore');
        nugetTool.pathArg(fn);

        tl.debug('sourcesFolder = ' + sourcesFolder);
        if (nugetConfigPath && nugetConfigPath.toLowerCase() != sourcesFolder.toLowerCase()) {
           
            tl._writeLine('nuget config path: ' + nugetConfigPath);
            nugetTool.arg('-configFile');
            nugetTool.pathArg(nugetConfigPath);
        }
        if (noCache) {
            nugetTool.arg('-NoCache');
        }
        if (nuGetRestoreArgs) {
            nugetTool.argString(nuGetRestoreArgs);
        }

        return nugetTool.exec(null);
    })
}

// get auth token and set credentials to NuGet config file
var tempNugetConfigPath = '';
if (nugetConfigPath && nugetConfigPath.toLowerCase() != sourcesFolder.toLowerCase()) {

    tl._writeLine('Get end point authorization');
    var auth = tl.getEndpointAuthorization('SYSTEMVSSCONNECTION', false);
    if (auth.scheme == 'OAuth') {
        var accessToken = auth.parameters['AccessToken'];
        tl.debug('accessToken: ' + accessToken);
    }
    else {
        tl.warning('Could not determine credentials to use for NuGet');
    }

    var nugetHelper = new helper.VsoNuGetHelper(nuGetPathToUse, nugetConfigPath, accessToken);
    tempNugetConfigPath = nugetHelper.tempNugetConfigPath;
 
    // add credentials to the user's nuget.config
     nugetHelper.setCredentialsNuGetConfigAndSaveTemp().then((res) => {  
        // reset nuget config path 
        nugetConfigPath = tempNugetConfigPath;
        restorePacakages();
    },
    (err) => {
        tl.error(err);
        tl.exit(1);
    });
}
else {
    restorePacakages();
}

function restorePacakages() {
    // Resolve files for the specified value or pattern
    var filesList: string[];
    if (solution.indexOf('*') == -1 && solution.indexOf('?') == -1) {
        // No pattern found, check literal path to a single file
        tl.checkPath(solution, 'files');

        // Use the specified single file
        filesList = [solution];

    } else {
        var firstWildcardIndex = function (str) {
            var idx = str.indexOf('*');

            var idxOfWildcard = str.indexOf('?');
            if (idxOfWildcard > -1) {
                return (idx > -1) ?
                    Math.min(idx, idxOfWildcard) : idxOfWildcard;
            }

            return idx;
        }

        // Find app files matching the specified pattern
        tl.debug('Matching glob pattern: ' + solution);

        // First find the most complete path without any matching patterns
        var idx = firstWildcardIndex(solution);
        tl.debug('Index of first wildcard: ' + idx);
        var findPathRoot = path.dirname(solution.slice(0, idx));

        tl.debug('find root dir: ' + findPathRoot);

        // Now we get a list of all files under this root
        var allFiles = tl.find(findPathRoot);

        // Now matching the pattern against all files
        filesList = tl.match(allFiles, solution, { matchBase: true });

        // Fail if no matching .sln files were found
        if (!filesList || filesList.length == 0) {
            tl.error('No matching files were found with search pattern: ' + solution);
            tl.exit(1);
        }
    }

    var result = Q({});
    filesList.forEach((fn) => {
        result = result.then(() => {
            return runnuget(fn);
        })
    })

    result.then(() => {
        tl._writeLine("packages are installed successfully.");
        tl.exit(0);
    })
        .fail((err) => {
            tl.error(err);
            tl.error("packages failed to install.");
            tl.exit(1);
        });
}
