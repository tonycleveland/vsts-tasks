/// <reference path="../../../definitions/vsts-task-lib.d.ts" />

import Q = require('q');
import http = require('http'); // import IncomingMessage from 'http' doesn't work
import https = require('https');

import tl = require('vsts-task-lib/task');

import {TaskReport} from  './taskreport';
import {RestResponse} from  './restresponse';
import {SonarQubeEndpoint} from './sonarqube-common';
import sqCommon = require('./sonarqube-common');


// Repeated query the server to determine if the task has finished.
// Returns true if the task is finished, or false if the timeout was exceeded without a positive answer from the server.
// Timeout and delay are in seconds, defaulting to 60 and 1 respectively if not specified
export function waitForAnalysisCompletion(taskReport:TaskReport, timeout?:number, delay?:number):Q.Promise<boolean> {
    var defer = Q.defer<boolean>();

    // Default values
    var timeout = timeout || 60;
    var delay = delay || 1;

    var isDone:boolean = false;
    // Every [delay] seconds, call isAnalysisComplete()
    var intervalObject = setInterval((taskReport, defer) => {
        isAnalysisComplete(taskReport).then((isDone:boolean) => {
            if (isDone) {
                clearInterval(intervalObject);
                defer.resolve(true);
            }
        });
    }, delay * 1000, taskReport);

    // After [timeout] seconds, delete the repeating call and return false.
    setTimeout((intervalObject, defer) => {
        clearInterval(intervalObject);
        defer.resolve(false);
    }, timeout * 1000, intervalObject);

    return defer.promise;
}

// Queries the server to determine if the task has finished, i.e. if the quality gate has been evaluated
export function isAnalysisComplete(taskReport:TaskReport):Q.Promise<boolean> {
    if (!taskReport) {
        throw new Error(tl.loc('sqAnalysis_TaskReportInvalid'));
    }

    return callSonarQubeRestEndpoint('/api/ce/task?id=' + taskReport.ceTaskId)
        .then((response:RestResponse) => {
            var responseJson:any = response.payloadToJson();
            if (!responseJson.task || !responseJson.task.status) {
                throw responseJson;
            }

            var taskStatus:string = responseJson.task.status;
            return (taskStatus.toUpperCase() == 'SUCCESS');
        }).fail((error) => {
            tl.debug('Could not fetch task status on ID' + taskReport.ceTaskId);
            throw error;
        });
}

// Query the server to determine the analysis id associated with the current analysis
export function getAnalysisId(taskReport:TaskReport):Q.Promise<string> {
    if (!taskReport) {
        throw new Error(tl.loc('sqAnalysis_TaskReportInvalid'));
    }

    return callSonarQubeRestEndpoint('/api/ce/task?id=' + taskReport.ceTaskId)
        .then((response:RestResponse) => {
            var responseJson:any = response.payloadToJson();
            if (!responseJson.task || !responseJson.task.analysisId) {
                throw responseJson;
            }

            return responseJson.task.analysisId;
        }).fail((error) => {
            tl.debug('Could not fetch task for task status on ID' + taskReport.ceTaskId);
            throw error;
        });
}

export function getQualityGateStatus(analysisId:string):Q.Promise<string> {
    return getQualityGateDetails(analysisId)
        .then((analysisDetails:any) => {
            return analysisDetails.projectStatus.status;
        });
}

export function getQualityGateDetails(analysisId:string):Q.Promise<Object> {
    return callSonarQubeRestEndpoint('/api/qualitygates/project_status?analysisId=' + analysisId)
        .then((response:RestResponse) => {
            var responseJson:any = response.payloadToJson();
            if (!responseJson.projectStatus || !responseJson.projectStatus.status) {
                throw responseJson;
            }

            return responseJson.projectStatus.status;
        }).fail((error) => {
            tl.debug('Could not fetch quality gate status on analysis ID' + analysisId);
            throw error;
        });
}

// Invokes a REST endpoint at the SonarQube server.
function callSonarQubeRestEndpoint(path:string):Q.Promise<RestResponse> {
    var defer = Q.defer<RestResponse>();

    var options = createSonarQubeHttpRequestOptions();
    options['path'] = path;

    var responseString:string = "";
    var request = https.request(options, (response:http.IncomingMessage) => {
        response.on('data', function (chunk) {
            responseString += chunk;
        });

        response.on('end', function () {
            tl.debug('Got response: ' + response.statusCode + " " + http.STATUS_CODES[response.statusCode] + " from " + path);

            var result = new RestResponse(response.statusCode, responseString);
            if (!result.wasSuccess()) {
                defer.reject<RestResponse>(result);
            } else {
                defer.resolve<RestResponse>(result);
            }
        })
    });

    request.write(/* payload */);
    request.end();
    return defer.promise;
}

// Constructs the options object used by the https.request() method.
function createSonarQubeHttpRequestOptions():Object {
    var endpoint:SonarQubeEndpoint = sqCommon.getSonarQubeEndpoint();

    var options = {
        host: endpoint.Url,
        method: 'GET',
        auth: {
            user: endpoint.Username,
            pass: endpoint.Password
        },
        headers: {
        }
    };

    var authObject = {};
    if (endpoint.Username) {
        authObject['user'] = endpoint.Username;
    }
    if (endpoint.Password) {
        authObject['pass'] = endpoint.Password;
    }
    options['auth'] = authObject;

    return options;
}

// Creates an encoded basic authentication string for use as a header in a request to the SonarQube server.
//function createBasicAuthHeader(username: string, password: string): string {
//    if (!username || !password) {
//        return null;
//    }
//
//    var encodedPair: string = new Buffer(username + ':' + password).toString('base64');
//    return 'Basic ' + encodedPair;
//}