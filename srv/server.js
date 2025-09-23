const cds = require('@sap/cds')
module.exports = cds.server

const cds_swagger = require('cds-swagger-ui-express')
cds.on('bootstrap', app => {

    app.get('/', (_, res) => {
        res.status(200).send('✅ CAP Service is healthy')
      })
      
    cds.env.features = cds.env.features || {};
    cds.env.features.limit = 15000;
    app.use(cds_swagger())

})
