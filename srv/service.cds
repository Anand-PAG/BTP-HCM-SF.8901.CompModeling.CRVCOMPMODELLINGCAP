using com.compmodel as compmodel from '../db/schema';

type ThresholdInput         : {
    year              : Integer;
    compaRatioRanges  : String(20);
    startRange        : Decimal(7, 4);
    endRange          : Decimal(7, 4);
    performanceRating : String(20);
    sequence          : String(3);
    fieldUsage        : String(1);
};

type SubZoneInput           : {
    year               : Integer;
    performanceSubZone : String(10);
    sequence           : String(3);
    fieldUsage         : String(1);
};

type CompensationRatioInput : {
    year               : Integer;
    performanceSubZone : String(10);
    payzones           : String(10);
    compaRatioRanges   : String(20);
    startRange         : Decimal(7, 4);
    endRange           : Decimal(7, 4);
    performanceRating  : String(50);
    thresholdFrom      : Decimal(5, 2);
    thresholdTo        : Decimal(5, 2);
    status             : String(1);
};

type CRVExceptionInput      : {
    field_id                 : String;
    custPERNR                : String;
    executiveRuleViolation   : String;
    mgrFirstName             : String;
    mgrLastName              : String;
    userName                 : String;
    custHireDate             : Date;
    custCompanyCode          : String;
    custBusUnit              : String;
    custDivision             : String;
    custDepartment           : String;
    jobTitle                 : String;
    custPayGradeLevel        : Integer;
    custTargetTab            : String;
    curSalary                : Decimal;
    custCurHrlySalary        : Decimal;
    payGuideMid              : Decimal;
    curRatio                 : Decimal;
    curRatioNoRound          : Decimal;
    custPerformanceZone      : String;
    custPDScore              : String;
    compaRatioRanges         : String;
    meritGuideline           : Decimal;
    merit                    : Decimal;
    merit_Percentage         : Decimal;
    commentformerit          : String;
    custExceptionCode        : String;
    lumpSum                  : Decimal;
    lumpSum_Percentage       : Decimal;
    finSalary                : Decimal;
    compaRatio               : Decimal;
    custMeritExcepReqAmt     : Decimal;
    custMeritExcepReqPct     : Decimal;
    custfinSalaryExcepReq    : Decimal;
    custCompaRatioExcepReq   : Decimal;
    custMeritExcepReqComment : String;
    salaryNote               : String;
    payAdjustmentAmount      : Decimal;
    payAdjustmentAmountPer   : Decimal;
    payAdjustmentFinalPay    : Decimal;
    status                   : String;
};

type BusinessDivisionInput  : {
    year         : Integer;
    custBusUnit  : String(60);
    custDivision : String(60);
    fieldUsage   : String(1);
};

type TargetTabsInput        : {
    year          : Integer;
    Modeltype     : String(10);
    TargetTabName : String(80);
    custBusUnit   : String(80);
    custDivision  : String;
    fieldUsage    : String(1);
}

type CompTargets {
    ID            : UUID;
    year          : Integer;
    Modeltype     : String(10);
    TargetTabName : String(40);
    curSalary     : Decimal(17, 2);
    changedStatus : String(1);
    createdBy     : String;
    changedBy     : String;
    fieldUsage    : String(1);
    to_businessUnits  : many BusinessUnitsType;
}
// type BuDivType {
//   custBusUnit   : String(80);
//   custDivision  : String(80);
// }

// type CompTargets {
//   ID            : UUID;
//   year          : Integer;
//   Modeltype     : String(10);
//   TargetTabName : String(40);
//   curSalary     : Decimal(17, 2);
//   changedStatus : String(1);
//   createdBy     : String;
//   changedBy     : String;
//   fieldUsage    : String(1);

//   // ✅ replace with a single collection
//   to_buDivs     : many BuDivType;
// }

type ratiowisecost          : {
    compaRatioRanges   : String(20);
    performanceSubZone : String(10);
    base               : Decimal(17, 2);
    sequence           : String(3)
};

type pdpwisecost            : {
    payzones          : String(10);
    performanceRating : String(50);
    totalbudget       : Decimal(17, 2);
    count             : Integer;
    to_ratiowise      : many ratiowisecost;
};

type targetTotals {
    year          : Integer;
    TargetTabName : String(40);
    curSalary     : Decimal(17, 2);
    to_pdpwise    : many pdpwisecost;
}

//Raghu added this code
type DeleteTargetTabInput   : {
    year          : Integer;
    Modeltype     : String(10);
    TargetTabName : String(80);
    custBusUnit   : String(80);
}


type Divisionstype {
    ID           : UUID;
    custDivision : String(80);
}

type BusinessUnitsType {
    ID           : UUID;
    custBusUnit : String(80);
    to_divisions  : many Divisionstype;

}

type ModelStatus {
    StatusCode        : String(1);
    StatusDescription : String;
}

type ApprovedData {
    approvedby   : String;
    approvedname : String;
}

type createdData {
    createdBy   : String;
    createdname : String;
}

type Targets {
    targetname : String(80)
}

type ModelId {
    model_Id : String(10);
}

type getdyanamiccolumns     : {
    ID               : UUID;
    compaRatioRanges : String(20);
    startRange       : Decimal(7, 4);
    endRange         : Decimal(7, 4);
    thresholdFrom    : Decimal(5, 2);
    thresholdTo      : Decimal(5, 2);
    sequence         : String(3);
};


type getdyanamicModel       : {
    performanceSubZone : String(10);
    payzones           : String(10);
    performanceRating  : String(50);
    sub_zonesequence   : String(3);
    to_columns         : many getdyanamiccolumns;
};

type getdyanamicmodelItems  : {
    ID               : UUID;
    compaRatioRanges : String(20);
    startRange       : Decimal(7, 4);
    endRange         : Decimal(7, 4);
    thresholdFrom    : Decimal(5, 2);
    thresholdTo      : Decimal(5, 2);
    value            : Decimal(5, 2);
    basecost         : Decimal(17, 2);
    sequence         : String(3);
};

type getmodelHeader         : {
    performanceSubZone : String(10);
    payzones           : String(10);
    performanceRating  : String(50);
    sub_zonesequence   : String(3);
    count              : Integer;
    totalBudget        : Decimal(17, 2);
    totalCost          : Decimal(17, 2);
    indicator          : String(1);
    to_columns         : many getdyanamicmodelItems;
};

type getTargetDivisions     : {
    custDivision : String(80);
};

type getTargetBusinessUnit : {
    custBusUnit : String(80);
};


type getmodel               : {
    ID                          : UUID;
    year                        : Integer;
    model_Id                    : String(10);
    //key modelOption                   : String;
    targetTab                   : String(80);
    custBusUnit                 : String(80);
    modelOption                 : String(10);
    totalsalary                 : Decimal(17, 2);
    pool                        : Decimal;
    pool_available              : Decimal(17, 2);
    totalDistributed            : Decimal(17, 2);
    totalDistrubuted_Percentage : Decimal(3, 2);
    remainingPool               : Decimal(17, 2);
    remainingPool_Percentage    : Decimal(3, 2);
    remainingPoolbalance        : Decimal(17, 2);
    status                      : String(1);
    modelName                   : String;
    publishedcomments           : String;
    to_modelheader              : many getmodelHeader;
    to_divisions                : many getTargetDivisions;
    to_businessUnits            : many getTargetBusinessUnit;
}


type yearfilter             : Integer;

type Email                  : String(255);

type modelId                : String(10);
type modelOption            : String(10);

type Role                   : String enum {
    approver;
    publisher;
}

type ToItemInput {
    id             : String;
    text           : String;
    value          : String;
    basecost       : String;
    threshholdfrom : String;
    threshholdto   : String;
    startrange     : String;
    endrange       : String;
    sequence       : String;
}

type ToHeaderInput {
    option             : String(10);
    performancesubzone : String;
    payzone            : String;
    rating             : String;
    budget             : String;
    total              : String;
    count              : Integer;
    Indicator          : String;
    sequence           : String;
    to_item            : many ToItemInput;
}

type CRVModelPayload {
    totalsalary                 : String;
    pool                        : String;
    pool_available              : String;
    totalDistributed            : String;
    totalDistrubuted_Percentage : String;
    remainingPool               : String;
    ModelId                     : String;
    year                        : String;
    Targettab                   : String;
    remainingPool_Percentage    : String;
    remainingPoolbalance        : String;
    createdname                 : String;
    modelName                   : String;
    publishedcomments           : String;
    to_header                   : many ToHeaderInput;
}

type statusChange           : {
    ModelId   : String;
    year      : Integer;
    Status    : String;
    Targettab : String;
    option    : String(10);
    emailid   : String;
    comments  : String;
    name      : String;
};

type publishdata            : {
    ModelId   : String;
    year      : Integer;
    Targettab : String;
    option    : String(10);
    //comments  : String;
    name      : String;
    emailid   : String;
};

type deleteModels :{
    ModelId   : String;
    year      : Integer;
    Targettab : String;
    option    : String(10);
    emailid   : String;
};

type rolestype              : {
    isAdmin    : Boolean;
    isUser     : Boolean;
    isApprover : Boolean;
    userEmail  : String;
}

type IntegrationMeta {
    Code : String;
    Desc : String;
}

service ZHR_COMP_CAP_CRVEXCEP_SRV {
    entity Thresholds              as projection on compmodel.ZHR_COMP_TBL_THRSHLD_MASTER;
    entity SubZones                as projection on compmodel.ZHR_COMP_TBL_SUBZONE_MASTER;
    entity CompensationRatioMaster as projection on compmodel.ZHR_COMP_TBL_COMPRATIO_MASTER;
    entity CRVException            as projection on compmodel.ZHR_COMP_TBL_CRV_EXPTN_MASTER;
    entity BusinessDivisions       as projection on compmodel.ZHR_COMP_TBL_BUDIV_MASTER;
    entity CRVTargets              as projection on compmodel.ZHR_COMP_TBL_TARGETTABS_MASTER;
    entity CRVDivisions            as projection on compmodel.ZHR_COMP_TBL_BUDIV_GROUP;
    entity crvModelsLaunch         as projection on compmodel.ZHR_COMP_TBL_CRV_MODEL_HEADER;
    entity crvModelsHeader         as projection on compmodel.ZHR_COMP_TBL_CRV_MODEL_THRSHLD_HEADER;
    entity crvModelsHeaderItem     as projection on compmodel.ZHR_COMP_TBL_CRV_MODEL_THRSHLD_ITEM;
    entity Persona                 as projection on compmodel.ZHR_COMP_TBL_USER;
    entity NumberRange             as projection on compmodel.ZHR_COMP_CRV_MODEL_NUMBERRANGE;
    entity Constants               as projection on compmodel.ZHR_COMP_TBL_CONSTANTS;
    entity ModelMaster             as projection on compmodel.ZHR_COMP_TBL_MODEL_MASTER;
    entity IntegrationConfig       as projection on compmodel.ZHR_COMP_TBL_INTEGRATION_CONFIG;


    // Custom action for bulk insert
    action   insertMultipleThresholds(entries: array of ThresholdInput);
    action   insertMultipleSubzones(entries: array of SubZoneInput);
    action   insertMultipleCompensationRatioMaster(entries: array of CompensationRatioInput);
    action   insertMultipleBusinessDivisions(entries: array of BusinessDivisionInput);
    action   insertMultipleCRVException(entries: array of CRVExceptionInput);
    action   insertMultipleTargetTabs(entries: array of TargetTabsInput);
    action   clearCRVExceptions(indicator: String);
    action   deleteBusinessDivisionsByYear(year: Integer);
    action   createupsertTargetTabs(nestedpayload: CompTargets);

    action   deleteTargetTab(year: Integer,
                             Modeltype: String(10),
                             TargetTabName: String(80)
                             )                               returns Boolean;

    action   createnumberRange(Modeltype: String(10), year: Integer)                returns ModelId;
    action   insertMultipleIntegrationConfig(entries: array of IntegrationConfig);


    action   postCRVModel(payload: CRVModelPayload)                                 returns {
        ok       : String;
        message  : String;
        model_Id : String;
    };

    action   updateStatus(payload: array of statusChange)                           returns {
        message : String;
        status  : String(3);
    }

    action   successfactorupload(payload: array of publishdata)                     returns {
        message : String;
        status  : String;
    }

    action   updateApproveoRejectnView(payload: statusChange)                       returns {
        message : String;
        status  : String;
    }

    action deleteCRVModels(payload: array of deleteModels) returns {
        message : String;
        status  : String;
    }


    function readCompensationRatioMaster()                                          returns array of CompensationRatioMaster;
    function readTargets(year: yearfilter)                                          returns array of CompTargets;
    function readCRVExceptionMaster()                                               returns array of CRVException;
    function readStatus()                                                           returns array of ModelStatus;
    function readTargetMaster()                                                     returns array of Targets;
    function readApprovedby()                                                       returns array of ApprovedData;
    function readCreatedby()                                                        returns array of createdData;
    function readTargetTotal(year: yearfilter, TargetTabName: String(40))           returns targetTotals;
    function readcreatemodel(year: yearfilter)                                      returns array of getdyanamicModel;
    function readModelData(year: yearfilter, modelId: modelId, option: modelOption) returns getmodel;
    function readModelId(year: yearfilter)                                          returns array of ModelId;
    function roles()                                                                returns rolestype;
    function readIntegrationMeta(type: String)                                      returns array of IntegrationMeta;

}

annotate ZHR_COMP_CAP_CRVEXCEP_SRV with @cds.server.body_parser.limit: '20000mb';


