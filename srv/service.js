const cds = require('@sap/cds');
const XLSX = require('xlsx');
const Sftpclient = require('ssh2-sftp-client');
const csv = require('csv-parser');
const fs = require('fs');
const path = require('path');

const axios = require('axios');
const { count } = require('console');

class ZHR_COMP_CAP_CRVEXCEP_SRV extends cds.ApplicationService {

  async init() {

    const { BusinessDivisions, CRVTargets, CRVDivisions, Thresholds, SubZones, CompensationRatioMaster, CRVException, crvModelsLaunch, NumberRange, crvModelsHeader, crvModelsHeaderItem, IntegrationConfig } = this.entities;

    function extractPathFromWhere(where) {
      if (!where) return null;
      const index = where.findIndex(item => item.ref?.[0] === 'path');
      if (index > -1 && where[index + 1] === '=' && where[index + 2]?.val) {
        return where[index + 2].val;
      }
      return null;
    }

    function getFieldValue(dataArray, fieldName) {
      const entry = dataArray.find(
        item => item.fieldName.toUpperCase() === fieldName.toUpperCase()
      );
      return entry ? entry.fieldValue : '';
    }

    //new logic here @08/23/2025

    async function getAppToken(tenantid, clientid, secretid, tokenendpoint) {

      if (!tenantid || !clientid || !secretid) {
        throw new Error('Graph creds missing: set AZURE_TENANT_ID, AZURE_CLIENT_ID, AZURE_CLIENT_SECRET');
      }

      const tokenEndpoint = `${tokenendpoint}${tenantid}/oauth2/v2.0/token`;
      const body = new URLSearchParams({
        client_id: clientid,
        client_secret: secretid,
        scope: 'https://graph.microsoft.com/.default',
        grant_type: 'client_credentials'
      }).toString();

      const { data } = await axios.post(tokenEndpoint, body, {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
      });

      return data.access_token;
    }

    // Send mail
    async function sendMailHelper({ subject, sender, recipients, htmlContent, clientid, secretid, tokenendpoint, tenantid, smtpurl }) {
      try {
        const token = await getAppToken(tenantid, clientid, secretid, tokenendpoint);
        const url = `${smtpurl}${encodeURIComponent(sender)}/sendMail`;
        const payload = {
          message: {
            subject,
            body: { contentType: 'HTML', content: htmlContent },
            toRecipients: recipients.map(e => ({ emailAddress: { address: e } }))
            // no "from" here – Graph sends as the user in the URL
          },
          saveToSentItems: true
        };

        await axios.post(url, payload, {
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
        });
        return { status: 'success', message: 'Mail sent successfully' };
      } catch (err) {
        return { status: 'error', message: err.response?.data || err.message };
      }
    }



    // -------- Email content builder --------
    function buildApprovalMail(d, modelurl, siteid) {
      const id = String(d.ModelId || '').trim();
      const yr = String(d.year || '').trim();
      const tab = String(d.Targettab || '').trim();
      const opt = String(d.option || '').trim();
      const who = String(d.name || '').trim();
      const comments = (d.comments || '').trim();

      const subject = `[Action Required] Approval requested for Model ${id} (${yr} · ${tab} · ${opt})`;

      const appBase = `${modelurl}${siteid}#zhr_comp_crvscreen_semobj-manage?sap-ui-app-id-hint=saas_approuter_zhrcompcrvscreenmodel&/crvscreen`;
      const viewUrl = appBase
        ? `${appBase}/${encodeURIComponent(tab)}/${encodeURIComponent(
          id
        )}/${encodeURIComponent(yr)}/${encodeURIComponent(opt)}`
        : '';

      const htmlContent = `
    <div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.5">
      <p>Hi,</p>
      <p><b>${who}</b> sent a model for your approval.</p>
      <table cellpadding="6" cellspacing="0" style="border-collapse:collapse;border:1px solid #eee">
        <tr><td style="border:1px solid #eee"><b>Model ID</b></td><td style="border:1px solid #eee">${id}</td></tr>
        <tr><td style="border:1px solid #eee"><b>Year</b></td><td style="border:1px solid #eee">${yr}</td></tr>
        <tr><td style="border:1px solid #eee"><b>Target Tab</b></td><td style="border:1px solid #eee">${tab}</td></tr>
        <tr><td style="border:1px solid #eee"><b>Option</b></td><td style="border:1px solid #eee">${opt}</td></tr>
      </table>
      ${comments ? `<p><b>Comments:</b><br/>${comments.replace(/\n/g, '<br/>')}</p>` : ''}
      ${viewUrl ? `<p><a href="${viewUrl}">Open in app</a></p>` : ''}
      <p>Thanks.</p>
    </div>
  `;
      return { subject, htmlContent };
    }

    function buildDecisionMail(status, d, modelurl, siteid) {
      const id = String(d.ModelId || '').trim();
      const yr = String(d.year || '').trim();
      const tab = String(d.Targettab || '').trim();
      const opt = String(d.option || '').trim();
      const who = String(d.name || '').trim();
      const comments = (d.comments || '').trim();

      const verb = status === 'A' ? 'Approved' : 'Rejected';
      const subject = `[${verb}] Model ${id} (${yr} · ${tab} · ${opt})`;

      const appBase = `${modelurl}${siteid}#zhr_comp_crvscreen_semobj-manage?sap-ui-app-id-hint=saas_approuter_zhrcompcrvscreenmodel&/crvscreen`;
      const viewUrl = appBase
        ? `${appBase}/${encodeURIComponent(tab)}/${encodeURIComponent(
          id
        )}/${encodeURIComponent(yr)}/${encodeURIComponent(opt)}`
        : '';

      const htmlContent = `
    <div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.5">
      <p>Hi,</p>
      <p>The model below was <b>${verb.toLowerCase()}</b> by <b>${who}</b>.</p>
      <table cellpadding="6" cellspacing="0" style="border-collapse:collapse;border:1px solid #eee">
        <tr><td style="border:1px solid #eee"><b>Model ID</b></td><td style="border:1px solid #eee">${id}</td></tr>
        <tr><td style="border:1px solid #eee"><b>Year</b></td><td style="border:1px solid #eee">${yr}</td></tr>
        <tr><td style="border:1px solid #eee"><b>Target Tab</b></td><td style="border:1px solid #eee">${tab}</td></tr>
        <tr><td style="border:1px solid #eee"><b>Option</b></td><td style="border:1px solid #eee">${opt}</td></tr>
        <tr><td style="border:1px solid #eee"><b>Decision</b></td><td style="border:1px solid #eee">${verb}</td></tr>
      </table>
      ${comments ? `<p><b>Comments:</b><br/>${comments.replace(/\n/g, '<br/>')}</p>` : ''}
      ${viewUrl ? `<p><a href="${viewUrl}">Open in app</a></p>` : ''}
      <p>Thanks.</p>
    </div>`;
      return { subject, htmlContent };
    }


    function resolveSender(req, data) {
      // Try CAP auth claims first
      const jwtEmail = req.user?.id;
      var resolved = jwtEmail;
      if (resolved == 'anonymous') {
        resolved = '';
      }
      return resolved || 'noreply.successfactors@sce.com';
    }


    // ---------- new logic here 08/23/2025----------

    this.on('updateStatus', async (req) => {
      const { payload } = req.data || {};
      if (!Array.isArray(payload) || payload.length === 0) {
        return { status: '404', message: 'No Data Found' };
      }
      req.user.id = req.req.authInfo.getEmail();
      const tx = cds.transaction(req);
      let mailed = 0;
      let mailErrors = 0;
      let emailmsg;
      let sendermail;
      var RejectedMail;

      const SFTPDetails = await tx.run(
        SELECT.from(this.entities.IntegrationConfig)
          .where({ type: 'SMTP' })
      );

      const clientid = getFieldValue(SFTPDetails, 'CLIENT_ID');
      const secretid = getFieldValue(SFTPDetails, 'CLIENT_SECRET');
      const tokenendpoint = getFieldValue(SFTPDetails, 'TOKEN_ENDPOINT');
      const tenantid = getFieldValue(SFTPDetails, 'TENANT_ID');
      const modelurl = getFieldValue(SFTPDetails, 'MODEL_URL');
      const siteid = getFieldValue(SFTPDetails, 'SITE_ID');
      const smtpurl = getFieldValue(SFTPDetails, 'SMTP_URL');

      for (let i = 0; i < payload.length; i++) {
        const data = payload[i];
        try {
          const keys = {
            year: data.year,
            model_Id: data.ModelId,
            targetTab: data.Targettab,
            modelOption: data.option
          };

          if (data.Status == 'A' || data.Status == 'R') {
            RejectedMail = await tx.run(
              SELECT.one.from(crvModelsLaunch)
                .columns('createdBy')
                .where(keys)
            );
            // status updates
            await tx.run(
              UPDATE(crvModelsLaunch).set({
                status: data.Status,
                approvedon: new Date().toISOString(),
                approvedname: data.name,
                approvedby: req.req.authInfo.getEmail(),
                changedname: data.name,
                approvedcomments: data.comments
              }).where(keys)
            );
            await tx.run(UPDATE(crvModelsHeader).set({ status: data.Status }).where(keys));
            await tx.run(UPDATE(crvModelsHeaderItem).set({ status: data.Status }).where(keys));

            // === NEW: direct recipient from crvModelsLaunch.modifiedby (fallback createdby) ===
            try {
              const sender = resolveSender(req, data);          // keep your existing helper
              sendermail = sender;
              const recipient =
                String(RejectedMail.createdBy).trim();

              if (!recipient) {
                req.warn('No recipient (modifiedby/createdby) found on crvModelsLaunch for decision mail.');
              } else if (!sender) {
                req.warn('Cannot resolve sender email. Set SENDER_EMAIL or ensure JWT has email.');
              } else {
                const { subject, htmlContent } = buildDecisionMail(data.Status, data, modelurl, siteid);
                const mailResp = await sendMailHelper({
                  appName: 'Comp Modelling',
                  subject,
                  sender,
                  recipients: [recipient],                     // <-- direct send to modifiedby
                  htmlContent,
                  clientid,
                  secretid,
                  tokenendpoint,
                  tenantid,
                  smtpurl
                });
                if (mailResp?.status == 'success') {
                  mailed++;
                } else {
                  mailErrors++;
                  emailmsg = mailResp?.message;
                  req.warn(`Mail send failed: ${JSON.stringify(mailResp?.message || mailResp)}`);
                }
              }

              //Published mail
              // if (data.Status == 'A') {
              //   try {
              //     const sender = resolveSender(req, data);          // keep your existing helper
              //     sendermail = sender;
              //     const recipient =
              //       String(data.emailid).trim();
              //     if (!recipient) {
              //       req.warn('No recipient (modifiedby/createdby) found on crvModelsLaunch for decision mail.');
              //     } else if (!sender) {
              //       req.warn('Cannot resolve sender email. Set SENDER_EMAIL or ensure JWT has email.');
              //     } else {
              //       const { subject, htmlContent } = buildDecisionMail(data.Status, data, modelurl, siteid);
              //       const mailResp = await sendMailHelper({
              //         appName: 'Comp Modelling',
              //         subject,
              //         sender,
              //         recipients: [recipient],                     // <-- direct send to modifiedby
              //         htmlContent,
              //         clientid,
              //         secretid,
              //         tokenendpoint,
              //         tenantid,
              //         smtpurl
              //       });
              //       if (mailResp?.status == 'success') {
              //         mailed++;
              //       } else {
              //         mailErrors++;
              //         emailmsg = mailResp?.message;
              //         req.warn(`Mail send failed: ${JSON.stringify(mailResp?.message || mailResp)}`);
              //       }
              //     }
              //   } catch (error) {

              //   }
              // }

            } catch (e) {
              mailErrors++;
              req.warn(`Decision mail exception: ${e?.message || e}`);
            }
            // === END NEW ===

          } else if (data.Status == 'W') {
            // send-for-approval
            await tx.run(
              UPDATE(crvModelsLaunch).set({
                status: data.Status,
                changedname: data.name
              }).where(keys)
            );
            await tx.run(UPDATE(crvModelsHeader).set({ status: data.Status }).where(keys));
            await tx.run(UPDATE(crvModelsHeaderItem).set({ status: data.Status }).where(keys));
            try {
              const sender = resolveSender(req, data);
              const approver = data.emailid && String(data.emailid).trim();
              sendermail = sender;
              if (!approver) req.warn('emailid (approver) missing. Skipping email.');
              if (!sender) req.warn('Cannot resolve sender email.');

              if (sender && approver) {
                const { subject, htmlContent } = buildApprovalMail(data, modelurl, siteid);
                const mailResp = await sendMailHelper({
                  appName: 'Comp Modelling',
                  subject,
                  sender,
                  recipients: [approver],
                  htmlContent,
                  clientid,
                  secretid,
                  tokenendpoint,
                  tenantid,
                  smtpurl
                });
                if (mailResp?.status == 'success') {
                  mailed++;
                } else {
                  mailErrors++;
                  emailmsg = mailResp?.message;
                  req.warn(`Mail send failed: ${JSON.stringify(mailResp?.message || mailResp)}`);
                }
              }
            } catch (e) {
              mailErrors++;
              req.warn(`Mail exception: ${e?.message || e}`);
            }

          } else if (data.Status == 'P') {
            // publish
            await tx.run(
              UPDATE(crvModelsLaunch).set({
                status: data.Status,
                changedname: data.name,
                publishedby: data.emailid,
                publishedname: data.name,
                publishedon: new Date().toISOString(),
                publishedcomments: data.comments
              }).where(keys)
            );
            await tx.run(UPDATE(crvModelsHeader).set({ status: data.Status }).where(keys));
            await tx.run(UPDATE(crvModelsHeaderItem).set({ status: data.Status }).where(keys));

          } else {
            req.warn(`Unsupported Status '${data.Status}' at index ${i}`);
          }

        } catch (e) {
          req.warn(`DB update failed at index ${i}: ${e?.message || e}`);
        }
      }

      return { status: '200', message: emailmsg, user: sendermail, mailed, mailErrors };
    });

    this.on('updateApproveoRejectnView', async (req) => {
      req.user.id = req.req.authInfo.getEmail();
      const { payload } = req.data || {};
      const data = payload;
      if (!payload) {
        return { status: '404', message: 'No Data Found' };
      }
      const tx = cds.transaction(req);
      const aStatus = ['A', 'P']
      let mailed = 0;
      let mailErrors = 0;
      let emailmsg;
      let sendermail;
      var AlreadyExists;
      var recipientMail
      const SFTPDetails = await tx.run(
        SELECT.from(this.entities.IntegrationConfig)
          .where({ type: 'SMTP' })
      );

      const clientid = getFieldValue(SFTPDetails, 'CLIENT_ID');
      const secretid = getFieldValue(SFTPDetails, 'CLIENT_SECRET');
      const tokenendpoint = getFieldValue(SFTPDetails, 'TOKEN_ENDPOINT');
      const tenantid = getFieldValue(SFTPDetails, 'TENANT_ID');
      const modelurl = getFieldValue(SFTPDetails, 'MODEL_URL');
      const siteid = getFieldValue(SFTPDetails, 'SITE_ID');
      const smtpurl = getFieldValue(SFTPDetails, 'SMTP_URL');

      try {
        const keys = {
          year: data.year,
          model_Id: data.ModelId,
          targetTab: data.Targettab,
          modelOption: data.option
        };
        recipientMail = await tx.run(
          SELECT.one.from(crvModelsLaunch)
            .columns('createdBy')
            .where(keys)
        );
        if (data.Status == 'A') {

          AlreadyExists = await tx.run(
            SELECT.one.from(crvModelsLaunch)
              .where({ targetTab: data.Targettab, status: { in: aStatus } })
          );
          if (AlreadyExists) {
            return { status: '500', message: `Another model is already approved/published for ${data.Targettab}.` }
          } else {

          }
        }
        await tx.run(
          UPDATE(crvModelsLaunch).set({
            status: data.Status,
            approvedon: new Date().toISOString(),
            approvedname: data.name,
            approvedby: req.req.authInfo.getEmail(),//data.emailid,
            changedname: data.name,
            approvedcomments: data.comments
          }).where(keys)
        );
        await tx.run(UPDATE(crvModelsHeader).set({ status: data.Status }).where(keys));
        await tx.run(UPDATE(crvModelsHeaderItem).set({ status: data.Status }).where(keys));
        try {
          const sender = resolveSender(req, data);          // keep your existing helper
          sendermail = sender;
          const recipient =
            String(recipientMail.createdBy).trim();

          if (!recipient) {
            req.warn('No recipient (modifiedby/createdby) found on crvModelsLaunch for decision mail.');
          } else if (!sender) {
            req.warn('Cannot resolve sender email. Set SENDER_EMAIL or ensure JWT has email.');
          } else {
            const { subject, htmlContent } = buildDecisionMail(data.Status, data, modelurl, siteid);
            const mailResp = await sendMailHelper({
              appName: 'Comp Modelling',
              subject,
              sender,
              recipients: [recipient],                     // <-- direct send to modifiedby
              htmlContent,
              clientid,
              secretid,
              tokenendpoint,
              tenantid,
              smtpurl
            });
            if (mailResp?.status == 'success') {
              mailed++;
            } else {
              mailErrors++;
              emailmsg = mailResp?.message;
              req.warn(`Mail send failed: ${JSON.stringify(mailResp?.message || mailResp)}`);
            }
          }
          // if (data.Status == 'A') {
          //   try {
          //     const sender = resolveSender(req, data);          // keep your existing helper
          //     sendermail = sender;
          //     const recipient =
          //       String(data.emailid).trim();
          //     if (!recipient) {
          //       req.warn('No recipient (modifiedby/createdby) found on crvModelsLaunch for decision mail.');
          //     } else if (!sender) {
          //       req.warn('Cannot resolve sender email. Set SENDER_EMAIL or ensure JWT has email.');
          //     } else {
          //       const { subject, htmlContent } = buildDecisionMail(data.Status, data, modelurl, siteid);
          //       const mailResp = await sendMailHelper({
          //         appName: 'Comp Modelling',
          //         subject,
          //         sender,
          //         recipients: [recipient],                     // <-- direct send to publisher
          //         htmlContent,
          //         clientid,
          //         secretid,
          //         tokenendpoint,
          //         tenantid,
          //         smtpurl
          //       });
          //       if (mailResp?.status == 'success') {
          //         mailed++;
          //       } else {
          //         mailErrors++;
          //         emailmsg = mailResp?.message;
          //         req.warn(`Mail send failed: ${JSON.stringify(mailResp?.message || mailResp)}`);
          //       }
          //     }
          //   } catch (error) {

          //   }
          // }
          var aMessaga = (data.Status == 'A') ? 'Approved successfully' : 'Rejected successfully';
          return { message: aMessaga, status: '200' }
        } catch (e) {
          mailErrors++;
          req.warn(`Decision mail exception: ${e?.message || e}`);
        }

      } catch (error) {
        return { message: 'Internal Server Error', status: '500' }
      }

    });


    /*---------------end here----------------*/

    this.on('READ', CompensationRatioMaster, async (req) => {
      const where = req.query.SELECT?.where;
      const filterPath = extractPathFromWhere(where);
      const tx = cds.tx(req);
      if (!filterPath) {
        return req.reject(400, 'Missing path query parameter');
      }

      const SFTPDetails = await tx.run(
        SELECT.from(this.entities.IntegrationConfig)
          .where({ type: 'SFTP' })
      );

      const host = getFieldValue(SFTPDetails, 'HOST');
      const port = getFieldValue(SFTPDetails, 'PORT');
      const username = getFieldValue(SFTPDetails, 'USERNAME');
      const passwrd = getFieldValue(SFTPDetails, 'PASSWORD');


      if (!host || !port || !username || !passwrd) {
        return req.reject(400, 'SFTP Configuration missing please maintain details');
      }

      const sftp = new Sftpclient();
      const config = {
        host: host,
        port: port,
        username: username,
        password: passwrd,
      };

      try {
        await sftp.connect(config);

        const fileList = await sftp.list(filterPath);

        const firstFile = fileList.find(file => file.type === '-');
        if (!firstFile) {
          await sftp.end();
          return [];
        }

        const filePath = `${filterPath}/${firstFile.name}`;
        const fileBuffer = await sftp.get(filePath);
        await sftp.end();

        const workbook = XLSX.read(fileBuffer, { type: 'buffer', raw: true });
        const allData = [];

        for (const sheetName of workbook.SheetNames) {
          const sheet = workbook.Sheets[sheetName];
          const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 });

          if (rows.length < 2) continue; // 1 header row + at least 1 data row

          const headers = rows[0]; // use first row as headers
          const dataRows = rows.slice(1); // data starts from second row

          for (const row of dataRows) {
            const entry = {};
            headers.forEach((key, idx) => {
              entry[key] = row[idx] ?? null;
            });
            allData.push(entry);
          }
        }

        const finalData = allData.map((r) => ({
          ID: cds.utils.uuid(),
          year: r.year,
          performanceSubZone: r.performanceSubZone || 0,
          payzones: r.payzones,
          compaRatioRanges: r.compaRatioRanges,
          startRange: parseFloat(r.startRange) || 0,
          endRange: parseFloat(r.endRange) || 0,
          performanceRating: r.PerformanceRating,
          thresholdFrom: r.thresholdFrom || 0,
          thresholdTo: r.thresholdTo || 0,
        }));

        return finalData;
      } catch (err) {
        console.error('SFTP Error:', err.message);
        return req.error(500, 'Failed to read SFTP file');
      } finally {
        sftp.end();
      }
    });



    this.on('READ', CRVException, async (req) => {
      const where = req.query.SELECT?.where;
      const filterPath = extractPathFromWhere(where);
      const tx = cds.tx(req);

      if (!filterPath) {
        return req.reject(400, 'Missing path query parameter');
      }

      const SFTPDetails = await tx.run(
        SELECT.from(this.entities.IntegrationConfig)
          .where({ type: 'SFTP' })
      );

      const host = getFieldValue(SFTPDetails, 'HOST');
      const port = getFieldValue(SFTPDetails, 'PORT');
      const username = getFieldValue(SFTPDetails, 'USERNAME');
      const passwrd = getFieldValue(SFTPDetails, 'PASSWORD');


      if (!host || !port || !username || !passwrd) {
        return req.reject(400, 'SFTP Configuration missing please maintain details');
      }

      const sftp = new Sftpclient();
      const config = {
        host: host,
        port: port,
        username: username,
        password: passwrd,
      };

      try {
        await sftp.connect(config);

        const fileList = await sftp.list(filterPath);


        const firstFile = fileList.find(file => file.type === '-');
        if (!firstFile) {
          await sftp.end();
          return [];
        }

        const filePath = `${filterPath}/${firstFile.name}`;
        const fileBuffer = await sftp.get(filePath);
        await sftp.end();

        const workbook = XLSX.read(fileBuffer, { type: 'buffer', raw: true });
        const allData = [];
        var percent = "";

        for (const sheetName of workbook.SheetNames) {
          const sheet = workbook.Sheets[sheetName];
          const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 });


          if (sheetName == 'Total_Budget') {
            const dataRowsPercentage = rows.slice(0);
            if (dataRowsPercentage.length > 0) {
              percent = dataRowsPercentage[1].length > 1 ? dataRowsPercentage[1][2] : "";
            }
          }
          else {
            const headers = rows[1]; // 2nd row = field IDs
            const dataRows = rows.slice(2); // actual data
            for (const row of dataRows) {
              const entry = {};
              headers.forEach((key, idx) => {
                entry[key] = row[idx] ?? null;
              });
              allData.push(entry);
            }
          }
        }
        console.log(allData);
        const finalData = allData.map((r) => ({

          field_id: cds.utils.uuid(),
          executiveRuleViolation: r.executiveRuleViolation || '',
          mgrFirstName: r.mgrFirstName || '',
          mgrLastName: r.mgrLastName || '',
          userName: r.userName || '',
          custPERNR: parseInt(r.custPERNR) || 0,
          custHireDate: r.custHireDate ? new Date(r.custHireDate) : null,
          custCompanyCode: r.custCompanyCode,
          custBusUnit: r.custBusUnit || '',
          custDivision: r.custDivision || '',
          custDepartment: r.custDepartment || '',
          jobTitle: r.jobTitle || '',
          custPayGradeLevel: parseInt(r.custPayGradeLevel) || 0,
          curSalary: parseFloat(r.curSalary) || 0,
          custCurHrlySalary: parseFloat(r.custCurHrlySalary) || 0,
          payGuideMid: parseFloat(r.payGuideMid) || 0,
          curRatio: parseFloat(r['%curRatio']) || 0,
          curRatioNoRound: Math.trunc(Number(r.customField6) * 10000) / 10000 || 0,
          custPerformanceZone: r.custPerformanceZone || '',
          custPDScore: r.custPDScore || '',
          meritGuideline: r.meritGuideline || '',
          merit: parseFloat(r.merit) || 0,
          //merit_Percentage: 'Percentage.valueOf()' || 0,
          merit_Percentage: r['%merit'] || 0,
          commentformerit: r['Comment for merit'] || '',
          custExceptionCode: r.custExceptionCode || '',
          lumpSum: parseFloat(r.lumpSum) || 0,
          lumpSum_Percentage: parseFloat(r['%lumpSum']) || 0,
          finSalary: parseFloat(r.finSalary) || 0,
          compaRatio: parseFloat(r['%compaRatio']) || 0,
          custMeritExcepReqAmt: parseFloat(r.custMeritExcepReqAmt) || 0,
          custMeritExcepReqPct: parseFloat(r.custMeritExcepReqPct) || 0,
          custfinSalaryExcepReq: parseFloat(r.custfinSalaryExcepReq) || 0,
          custCompaRatioExcepReq: parseFloat(r.custCompaRatioExcepReq) || 0,
          custMeritExcepReqComment: r.custMeritExcepReqComment || '',
          salaryNote: r.salaryNote || '',
          custTargetTab: r.custTargetTab || '',
          compaRatioRanges: r.compaRatioRanges || '',
          payAdjustmentAmount: parseFloat(r.payAdjustmentAmount) || 0,
          payAdjustmentAmountPer: parseFloat(r.payAdjustmentAmountPer) || 0,
          payAdjustmentFinalPay: parseFloat(r.payAdjustmentFinalPay) || 0,
          status: 'S', // or infer from file if available


        })
        );

        //Update Pool Percentage
        if (percent) {
          console.log(percent);
          const keys = {
            type: 'SFTP',
            fieldName: 'POOLPERCENTAGE'
          };
          const existing = await tx.run(
            SELECT.one.from(this.entities.IntegrationConfig)
              .where(keys)
          );
          if (existing) {
            await tx.run(
              UPDATE(this.entities.IntegrationConfig)
                .set({ fieldValue: percent })
                .where(keys)
            );
          } else {
            var poolpercentage = {};
            poolpercentage.type = 'SFTP';
            poolpercentage.fieldName = 'POOLPERCENTAGE';
            poolpercentage.fieldValue = percent;
            await tx.run(
              INSERT.into(this.entities.IntegrationConfig).entries(poolpercentage)
            );
          }
        }

        return finalData;
      } catch (err) {
        console.error('SFTP Error:', err.message);
        return req.error(500, 'Failed to read SFTP file');
      } finally {
        sftp.end();
      }
    });

    this.on('insertMultipleCRVException', async (req) => {
      const { entries } = req.data;
      req.user.id = req.req.authInfo.getEmail();
      if (!Array.isArray(entries) || entries.length === 0) {
        return req.error(400, 'No CRVException entries provided');
      }

      // Optional: Log the shape of data

      // Validate composite key fields
      const invalidEntry = entries.find(e => !e.field_id || !e.custPERNR);
      if (invalidEntry) {
        console.error('Invalid entry found:', invalidEntry);
        return req.error(400, 'Each entry must have both field_id and custPERNR');
      }


      try {
        // Step 2: Insert new records
        await INSERT.into(this.entities.CRVException).entries(entries);
        return req.reply({
          message: `${entries.length} CRVException records inserted successfully after clearing existing ones.`,
        });

      } catch (insertErr) {
        console.error(' Insert failed:', insertErr);
        return req.error(500, `Insert failed: ${insertErr.message}`);
      }
    });


    this.on('clearCRVExceptions', async (req) => {
      try {
        await DELETE.from(this.entities.CRVException);
        return req.reply({ message: 'All CRVException records deleted successfully.' });
      } catch (err) {
        console.error(' Deletion failed:', err);
        return req.error(500, `Deletion failed: ${err.message}`);
      }
    });

    this.on('READ', 'BusinessDivisions', async (req) => {
      return await SELECT.from(BusinessDivisions);
    });


    this.on('DELETE', 'BusinessDivisions', async (req) => {
      try {
        await DELETE.from(BusinessDivisions).where({
          year: req.data.year
        });
        return req.data
      } catch (error) {
        throw new Error(error);
      }
    });

    // Delete BusinessDivisions by year
    this.on('deleteBusinessDivisionsByYear', async (req) => {
      const { year } = req.data || {};
      if (!Number.isInteger(year)) return req.error(400, 'Invalid or missing year');

      try {
        const tx = cds.tx(req);
        const affected = await tx.run(
          DELETE.from(BusinessDivisions).where({ year })
        );
        return req.reply({ message: `Deleted ${affected} BusinessDivisions rows for ${year}` });
      } catch (err) {
        console.error('Deletion failed:', err);
        return req.error(500, `Deletion failed: ${err.message}`);
      }
    });


    // BusinessDivisions
    this.on('insertMultipleBusinessDivisions', async (req) => {
      const { entries } = req.data;
      req.user.id = req.req.authInfo.getEmail();
      if (!Array.isArray(entries) || entries.length === 0) return req.error(400, 'No entries provided');

      const currentYear = new Date().getFullYear();
      try {
        const tx = cds.tx(req);
        await tx.run(DELETE.from(this.entities.BusinessDivisions).where({ year: currentYear }));
        await tx.run(INSERT.into(this.entities.BusinessDivisions).entries(entries));
        return req.reply({ message: `${entries.length} BusinessDivisions records inserted for ${currentYear}.` });
      } catch (error) {
        console.error('Bulk insert failed:', error);
        return req.error(500, `Insert failed: ${error.message}`);
      }
    });

    // Thresholds
    this.on('insertMultipleThresholds', async (req) => {
      const { entries } = req.data;
      if (!Array.isArray(entries) || entries.length === 0) return req.error(400, 'No entries provided');

      const currentYear = new Date().getFullYear();
      try {
        const tx = cds.tx(req);
        await tx.run(DELETE.from(this.entities.Thresholds).where({ year: currentYear }));
        await tx.run(INSERT.into(this.entities.Thresholds).entries(entries));
        return req.reply({ message: `${entries.length} Threshold records inserted for ${currentYear}.` });
      } catch (error) {
        console.error('Bulk insert failed:', error);
        return req.error(500, `Insert failed: ${error.message}`);
      }
    });

    // SubZones
    this.on('insertMultipleSubzones', async (req) => {
      const { entries } = req.data;
      if (!Array.isArray(entries) || entries.length === 0) return req.error(400, 'No entries provided');

      const currentYear = new Date().getFullYear();
      try {
        const tx = cds.tx(req);
        await tx.run(DELETE.from(this.entities.SubZones).where({ year: currentYear }));
        await tx.run(INSERT.into(this.entities.SubZones).entries(entries));
        return req.reply({ message: `${entries.length} Subzone records inserted for ${currentYear}.` });
      } catch (error) {
        console.error('Bulk insert failed:', error);
        return req.error(500, `Insert failed: ${error.message}`);
      }
    });

    // CompensationRatioMaster
    this.on('insertMultipleCompensationRatioMaster', async (req) => {
      const { entries } = req.data;
      req.user.id = req.req.authInfo.getEmail();
      if (!Array.isArray(entries) || entries.length === 0) return req.error(400, 'No entries provided');

      const currentYear = new Date().getFullYear();
      try {
        const tx = cds.tx(req);
        await tx.run(DELETE.from(this.entities.CompensationRatioMaster).where({ year: currentYear }));
        await tx.run(INSERT.into(this.entities.CompensationRatioMaster).entries(entries));
        return req.reply({ message: `${entries.length} CompensationRatio records inserted for ${currentYear}.` });
      } catch (error) {
        console.error('Bulk insert failed:', error);
        return req.error(500, `Insert failed: ${error.message}`);
      }
    });




    this.on('READ', 'Thresholds', async (req) => {
      return await SELECT.from(Thresholds);
    });


    this.on('READ', 'SubZones', async (req) => {
      return await SELECT.from(SubZones);
    });


    this.on('readCompensationRatioMaster', async () => {
      return await SELECT.from(this.entities.CompensationRatioMaster);
    });



    this.on('insertMultipleTargetTabs', async (req) => {
      const { entries } = req.data;
      req.user.id = req.req.authInfo.getEmail();
      if (!Array.isArray(entries) || entries.length === 0) {
        return req.error(400, 'No entries provided');
      }

      try {
        await INSERT.into(this.entities.TargetTabs).entries(entries);
        return req.reply({ message: `${entries.length} TargetTabs records inserted.` });
      } catch (error) {
        console.error('Bulk insert failed:', error);
        return req.error(500, `Insert failed: ${error.message}`);
      }
    });


    // this.on('readTargets', async (req) => {
    //   const { year } = req.data;

    //   const TargetData = await SELECT.from(CRVTargets).where({ year });

    //   if (TargetData.length === 0) {
    //     return [];
    //   }
    //   const TargetIds = TargetData.map(t => t.TargetTabName);
    //   const DivisionsData = await SELECT.from(CRVDivisions).where({
    //     TargetTabName: { in: TargetIds },
    //     year: year
    //   });
    //   const finalresult = TargetData.map(td => ({
    //     ID: td.uuid,
    //     year: td.year,
    //     Modeltype: td.Modeltype,
    //     TargetTabName: td.TargetTabName,
    //     custBusUnit: td.custBusUnit,
    //     changedStatus: td.changedStatus,
    //     createdBy: td.createdBy,
    //     modifiedBy: td.modifiedBy,
    //     fieldUsage: td.fieldUsage,
    //     to_divisions: DivisionsData.filter(
    //       d => d.year === td.year
    //         && d.Modeltype === td.Modeltype
    //         && d.TargetTabName === td.TargetTabName
    //     ).map(d => ({
    //       ID: d.uuid,
    //       custDivision: d.custDivision
    //     }))
    //   }));
    //   return finalresult;
    // });

    //  this.on('readTargets', async (req) => {
    //   const { year } = req.data;

    //   const TargetData = await SELECT.from(CRVTargets).where({ year });
    //   if (TargetData.length === 0) return [];

    //   const TargetIds = TargetData.map(t => t.TargetTabName);
    //   const DivisionsData = await SELECT.from(CRVDivisions).where({
    //     TargetTabName: { in: TargetIds },
    //     year
    //   });

    //   // group by year+Modeltype+TargetTabName
    //   const grouped = {};
    //   for (const td of TargetData) {
    //     const key = `${td.year}|${td.Modeltype}|${td.TargetTabName}`;
    //     if (!grouped[key]) {
    //       grouped[key] = {
    //         ID: td.ID,
    //         year: td.year,
    //         Modeltype: td.Modeltype,
    //         TargetTabName: td.TargetTabName,
    //         changedStatus: td.changedStatus,
    //         createdBy: td.createdBy,
    //         modifiedBy: td.modifiedBy,
    //         fieldUsage: td.fieldUsage,
    //         to_buDivs: []
    //       };
    //     }
    //   }

    //   DivisionsData.forEach(d => {
    //     const key = `${d.year}|${d.Modeltype}|${d.TargetTabName}`;
    //     if (grouped[key]) {
    //       grouped[key].to_buDivs.push({
    //         custBusUnit: d.custBusUnit,
    //         custDivision: d.custDivision
    //       });
    //     }
    //   });

    //   return Object.values(grouped);
    // });

    // ------------09/28 change
    this.on('readTargets', async (req) => {
      const { year } = req.data;

      const TargetData = await SELECT.from(CRVTargets).where({ year });
      if (TargetData.length === 0) return [];

      const TargetIds = TargetData.map(t => t.TargetTabName);

      const DivisionsData = await SELECT.from(CRVDivisions).where({
        TargetTabName: { in: TargetIds },
        year
      });

      const finalresult = TargetData.map(td => {
        // collect divisions grouped by BusinessUnit
        const buMap = {};
        DivisionsData.filter(
          d => d.year === td.year &&
            d.Modeltype === td.Modeltype &&
            d.TargetTabName === td.TargetTabName
        ).forEach(d => {
          if (!buMap[d.custBusUnit]) {
            buMap[d.custBusUnit] = {
              custBusUnit: d.custBusUnit,
              to_divisions: []
            };
          }
          if (d.custDivision) {
            buMap[d.custBusUnit].to_divisions.push({
              ID: d.ID,
              custDivision: d.custDivision
            });
          }
        });

        return {
          ID: td.ID,
          year: td.year,
          Modeltype: td.Modeltype,
          TargetTabName: td.TargetTabName,
          changedStatus: td.changedStatus,
          createdBy: td.createdBy,
          changedBy: td.changedBy,
          fieldUsage: td.fieldUsage,
          to_businessUnits: Object.values(buMap)
        };
      });

      return finalresult;
    });

    this.on('createupsertTargetTabs', async (req) => {
      const { nestedpayload } = req.data;

      try {
        const {
          ID,
          year,
          Modeltype,
          TargetTabName,
          changedStatus,
          createdBy,
          changedBy,
          fieldUsage,
          to_businessUnits = []
        } = nestedpayload;

        if (!year || !Modeltype || !TargetTabName) {
          return req.error(400, 'year, Modeltype, and TargetTabName are required.');
        }

        // check if header exists
        const existingModel = await SELECT.one.from(CRVTargets).where({
          year,
          Modeltype,
          TargetTabName
        });

        if (existingModel) {
          // update header
          await UPDATE(CRVTargets).set({
            changedStatus,
            fieldUsage,
            changedBy
          }).where({
            ID: existingModel.ID,
            year,
            Modeltype,
            TargetTabName
          });

          // delete old children
          await DELETE.from(CRVDivisions).where({ year, Modeltype, TargetTabName });
        } else {
          // insert header
          await INSERT.into(CRVTargets).entries({
            year,
            Modeltype,
            TargetTabName,
            changedStatus,
            fieldUsage,
            createdBy,
            changedBy
          });
        }

        // insert new children
        for (const bu of to_businessUnits) {
          if (!bu.custBusUnit) continue;

          if (bu.to_divisions?.length > 0) {
            for (const div of bu.to_divisions) {
              await INSERT.into(CRVDivisions).entries({
                year,
                Modeltype,
                TargetTabName,
                custBusUnit: bu.custBusUnit.trim(),
                custDivision: (div.custDivision || "").trim()
              });
            }
          } else {
            // BU without divisions
            await INSERT.into(CRVDivisions).entries({
              year,
              Modeltype,
              TargetTabName,
              custBusUnit: bu.custBusUnit.trim(),
              custDivision: ""
            });
          }
        }

        return existingModel
          ? 'Target Tab updated successfully'
          : 'Target Tab created successfully';

      } catch (error) {
        return req.error(500, `Upsert/Create failed: ${error.message}`);
      }
    });

    this.on('deleteTargetTab', async (req) => {
      const { CRVTargets, CRVDivisions } = this.entities;
      const { year, Modeltype, TargetTabName } = req.data || {};

      if (!year || !Modeltype || !TargetTabName) {
        return req.error(400, 'year, Modeltype, and TargetTabName are required');
      }

      const tx = cds.tx(req);

      // check if header exists
      const header = await tx.run(
        SELECT.one.from(CRVTargets).columns('ID')
          .where({ year, Modeltype, TargetTabName })
      );
      if (!header) return { message: 'Nothing to delete' };

      // delete all children (all BUs + divisions under this target)
      const divDeleted = await tx.run(
        DELETE.from(CRVDivisions).where({ year, Modeltype, TargetTabName })
      );

      // delete header
      const headDeleted = await tx.run(
        DELETE.from(CRVTargets).where({ ID: header.ID })
      );

      return { message: `OK (divisions: ${divDeleted}, header: ${headDeleted})` };
    });


    // ------09/28 changes end----






    this.on('readTargetTotal', async (req) => {
      const { year, TargetTabName } = req.data;
      const CompensationRatioMaster = cds.entities['com.compmodel.ZHR_COMP_TBL_COMPRATIO_MASTER'];
      const Thresholds = cds.entities['com.compmodel.ZHR_COMP_TBL_THRSHLD_MASTER'];
      const db = cds.db;
      const TargetData = await SELECT.from(CRVTargets).where({ year: year, Modeltype: 'CRV', TargetTabName: TargetTabName });
      const Divisions = await SELECT.from(CRVDivisions).where({
        TargetTabName: TargetTabName,
        Modeltype: 'CRV',
        year: year
      });
      const aBusinessUnit = [...new Set(Divisions.map(d => d.custBusUnit))];

      if (TargetData.length === 0) {
        return null;
      }
      const aDivisions = Divisions.map(d => d.custDivision) || [];
      const aExceptionData = await SELECT.from(CRVException)
        .columns(
          //'custBusUnit',
          'sum(curSalary) as totalSalary'
        ).where({
          custBusUnit: { in: aBusinessUnit },
          custDivision: { in: aDivisions }
        });//.groupBy('custBusUnit');

      const pdpwisedata = await db.run(
        SELECT
          .from(CRVException)
          .columns(
            'custPerformanceZone',
            'custPDScore',
            'sum(curSalary) as totalbudget',
            'count(custPERNR) as totalcount'
          )
          .where({
            custBusUnit: { in: aBusinessUnit },//businessUnit,
            custDivision: { in: aDivisions }
          })
          .groupBy('custPerformanceZone', 'custPDScore')
      );

      //const thr = await SELECT.from(Thresholds);

      const compRatio = await SELECT
        .from('com.compmodel.ZHR_COMP_TBL_COMPRATIO_MASTER as cm')
        .join('com.compmodel.ZHR_COMP_TBL_THRSHLD_MASTER as th')
        .on(`cm.compaRatioRanges = th.compaRatioRanges
             AND cm.startRange = th.startRange
             AND cm.endRange = th.endRange`)
        .columns(
          'cm.compaRatioRanges',
          'cm.payzones',
          'cm.performanceRating',
          'cm.performanceSubZone',
          'cm.startRange',
          'cm.endRange',
          'th.sequence'
        )
        .where(`cm.year = '${year}' AND cm.status = 'A'`);

      //Range function
      function isInRange(ratio, rule) {
        const rangeStr = rule.compaRatioRanges.trim();
        ratio = parseFloat(ratio);
        if (rangeStr.startsWith('<')) {
          return ratio <= rule.endRange;
        }

        if (rangeStr.startsWith('>=')) {
          return ratio >= rule.startRange;
        }

        if (rangeStr.startsWith('>') && rangeStr.includes('<')) {
          return ratio >= rule.startRange && ratio <= rule.endRange;
        }

        if (rangeStr.startsWith('>')) {
          return ratio >= rule.startRange && ratio <= rule.endRange;
        }

        if (rangeStr.includes('-')) {
          const lowerExclusive = rangeStr.includes('>') && !rangeStr.includes('>=');
          const upperExclusive = rangeStr.includes('<') && !rangeStr.includes('<=');

          const lowerCheck = lowerExclusive ? ratio >= rule.startRange : ratio >= rule.startRange;
          const upperCheck = upperExclusive ? ratio <= rule.endRange : ratio <= rule.endRange;

          return lowerCheck && upperCheck;
        }

        return false;
      } //end of range function

      const expanded = compRatio.flatMap(entry => {
        const ratings = entry.performanceRating.split(',').map(r => r.trim());
        return ratings.map(rating => ({
          ...entry,
          performanceRating: rating
        }));
      });
      const crvdata = await SELECT
        .from(CRVException)
        .columns(
          'custPerformanceZone',
          'custPDScore',
          'curSalary',
          'curRatioNoRound',
          'custPERNR'
        )
        .where({
          custBusUnit: { in: aBusinessUnit },//businessUnit,
          custDivision: { in: aDivisions }
        });
      
      const sumData = expanded.map(rule => {
        const matchedPernrs = new Set();

        const base = crvdata.reduce((sum, data) => {
          const sameRating = data.custPDScore === rule.performanceRating;
          const sameZone = data.custPerformanceZone === rule.payzones;
          const ratio = parseFloat(data.curRatioNoRound);
          const inRange = isInRange(ratio, rule);

          return sameRating && sameZone && inRange
            ? sum + parseFloat(data.curSalary)
            : sum;
        }, 0);

        const Empdata = crvdata.filter(empdata => 
          empdata.custPDScore === rule.performanceRating &&
          empdata.custPerformanceZone === rule.payzones 
        );

        Empdata.forEach(dataemp => {
          console.log('dataaa'+ dataemp);
          const ratio = parseFloat(dataemp.curRatioNoRound);
          console.log(ratio);
          const inRange = isInRange(ratio, rule);
          if (inRange){
            matchedPernrs.add(dataemp.custPERNR);
          }
          
        });

        return {
          payzones: rule.payzones,
          performanceRating: rule.performanceRating,
          range: rule.compaRatioRanges,
          performanceSubZone: rule.performanceSubZone,
          sequence: rule.sequence,
          base: +base.toFixed(2),
          count: matchedPernrs.size
        };
      });

      //Group and merge with comma seperated again
      const grouped = {};

      for (const item of sumData) {
        const key = `${item.payzones}|${item.performanceSubZone}|${item.range}`;

        if (!grouped[key]) {
          grouped[key] = {
            payzones: item.payzones,
            performanceSubZone: item.performanceSubZone,
            compaRatioRanges: item.range,
            sequence: item.sequence,
            performanceRatingSet: new Set(),
            base: 0,
            count: 0
          };
        }

        grouped[key].performanceRatingSet.add(item.performanceRating);
        grouped[key].base += item.base;
        grouped[key].count += item.count;
      }
      const filterexpanded = expanded.filter(e =>
        e.payzones === '6' //&&
        //e.performanceRating === 'E/E'
      );

      const filtertest = sumData.filter(f =>
        f.performanceRating === 'E/E'
      );
      const crvfilter = crvdata.filter(c =>
        c.custPDScore === 'E/E'
      );
      console.log(crvfilter);


      // Convert Set to comma-separated string and return final output
      const output = Object.values(grouped).map(g => ({
        payzones: g.payzones,
        performanceSubZone: g.performanceSubZone,
        compaRatioRanges: g.compaRatioRanges,
        sequence: g.sequence,
        performanceRating: Array.from(g.performanceRatingSet).join(','),
        base: +g.base.toFixed(2),
        count: +g.count
      }));

      const aFinal = {
        year: year, TargetTabName: TargetTabName,
        curSalary: aExceptionData[0]?.totalSalary ?? 0.00,
        to_pdpwise: pdpwisedata.map(pd => ({
          payzones: pd.custPerformanceZone,
          performanceRating: pd.custPDScore,
          count: pd.totalcount,
          totalbudget: pd.totalbudget,
          to_ratiowise: output.filter(f =>
            f.payzones === pd.custPerformanceZone
          ).map(t => ({
            performanceSubZone: t.performanceSubZone,
            compaRatioRanges: t.compaRatioRanges,
            sequence: t.sequence,
            base: t.base,
            count: t.count
          })) || []
        })) || [],

      }
      return aFinal;
    });

    // this.on('createupsertTargetTabs', async (req) => {
    //   const { nestedpayload } = req.data;
    //   try {
    //     const {
    //       ID,
    //       year,
    //       Modeltype,
    //       TargetTabName,
    //       custBusUnit,
    //       changedStatus,
    //       createdBy,
    //       changedBy,
    //       fieldUsage,
    //       to_divisions = []
    //     } = nestedpayload;

    //     if (!year || !Modeltype) {
    //       return req.error(400, 'Both year and Modeltype are required.');
    //     }

    //     const existingModel = await SELECT.from(CRVTargets).where({
    //       TargetTabName: TargetTabName,
    //       year: year,
    //       Modeltype: Modeltype
    //     });
    //     if (existingModel.length > 0) {
    //       try {
    //         await UPDATE(CRVTargets).set({
    //           custBusUnit,
    //           changedStatus,
    //           fieldUsage,
    //         }).where({
    //           ID: existingModel[0].ID,
    //           year,
    //           Modeltype,
    //           TargetTabName,
    //         });
    //         try {
    //           await DELETE.from(CRVDivisions).where({ year, Modeltype, TargetTabName });
    //           for (const div of to_divisions) {
    //             try {
    //               for (const div of to_divisions) {
    //                 await INSERT.into(CRVDivisions).entries({
    //                   year,
    //                   Modeltype,
    //                   TargetTabName,
    //                   custBusUnit,
    //                   custDivision: div.custDivision
    //                 });
    //               }
    //               return 'Target Tab Updated Successfully'
    //             } catch (error) {
    //               return req.error(500, `Divisions failed: ${error.message}`);
    //             }

    //           }
    //         } catch {
    //           return req.error(500, `Create failed: ${error.message}`);
    //         }
    //       } catch (error) {
    //         return req.error(500, `Create failed: ${error.message}`);
    //       }
    //     } else {
    //       await INSERT.into(CRVTargets).entries({
    //         year,
    //         Modeltype,
    //         TargetTabName,
    //         custBusUnit,
    //         changedStatus,
    //         fieldUsage,
    //       });
    //       for (const div of to_divisions) {
    //         await INSERT.into(CRVDivisions).entries({
    //           year,
    //           Modeltype,
    //           TargetTabName,
    //           custBusUnit,
    //           custDivision: div.custDivision
    //         });
    //       }
    //       return 'Target Tab created successfully';
    //     }
    //   } catch (error) {
    //     return req.error(500, `Upsert/Create failed: ${error.message}`);
    //   }

    // });

    // this.on('deleteTargetTab', async (req) => {
    //   const { CRVTargets, CRVDivisions } = this.entities;
    //   const { year, Modeltype, TargetTabName, custBusUnit } = req.data || {};

    //   if (!year || !Modeltype || !TargetTabName || !custBusUnit) {
    //     return req.error(400, 'year, Modeltype, TargetTabName, custBusUnit are required');
    //   }

    //   const tx = cds.tx(req);

    //   const header = await tx.run(
    //     SELECT.one.from(CRVTargets).columns('ID')
    //       .where({ year, Modeltype, TargetTabName, custBusUnit })
    //   );
    //   if (!header) return { message: 'Nothing to delete' };

    //   const divDeleted = await tx.run(
    //     DELETE.from(CRVDivisions).where({ year, Modeltype, TargetTabName, custBusUnit })
    //   );
    //   const headDeleted = await tx.run(
    //     DELETE.from(CRVTargets).where({ ID: header.ID })
    //   );

    //   return { message: `OK (divisions: ${divDeleted}, header: ${headDeleted})` };
    // });
    //   this.on('deleteTargetTab', async (req) => {
    //   const { CRVTargets, CRVDivisions } = this.entities;
    //   const { year, Modeltype, TargetTabName } = req.data || {};

    //   if (!year || !Modeltype || !TargetTabName) {
    //     return req.error(400, 'year, Modeltype, TargetTabName are required');
    //   }

    //   const tx = cds.tx(req);

    //   // Delete all divisions linked to this TargetTab (across all BUs)
    //   const divDeleted = await tx.run(
    //     DELETE.from(CRVDivisions).where({ year, Modeltype, TargetTabName })
    //   );

    //   // Delete all TargetTab rows (one per BU in DB)
    //   const headDeleted = await tx.run(
    //     DELETE.from(CRVTargets).where({ year, Modeltype, TargetTabName })
    //   );

    //   return { message: `OK (divisions deleted: ${divDeleted}, targetTab rows deleted: ${headDeleted})` };
    // });

    //  this.on('deleteTargetTab', async (req) => {
    //     const { year, Modeltype, TargetTabName } = req.data || {};

    //     // Basic validation
    //     if (!year || !Modeltype || !TargetTabName) {
    //       return req.reject(400, 'year, Modeltype, TargetTabName are required');
    //     }

    //     const tx = cds.tx(req);
    //     const where = {
    //       year: Number(year),
    //       Modeltype: String(Modeltype),
    //       TargetTabName: String(TargetTabName)
    //     };

    //     // (Optional) Server-side guard — block if there are launched models
    //     // If you have a view/entity for launched models, uncomment and adjust:
    //     //
    //     // const existsLaunch = await tx.run(
    //     //   SELECT.one`1`.from('YourModelsLaunchView')
    //     //     .where({ year: where.year, targetTab: where.TargetTabName })
    //     // );
    //     // if (existsLaunch) return req.reject(409, 'Target Tab is used in a Model and cannot be deleted.');

    //     // 1) delete children (no automatic cascade with key-based composition)
    //     await tx.run(DELETE.from(CRVDivisions).where(where));

    //     // 2) delete header
    //     const headDeleted = await tx.run(
    //       DELETE.from(CRVTargets).where(where)
    //     );

    //     // Return Boolean as defined in CDS
    //     return !!headDeleted; // true if a header row was removed
    //   });

    // this.on('createupsertTargetTabs', async (req) => {
    //   const { nestedpayload } = req.data;
    //   try {
    //     const {
    //       year, Modeltype, TargetTabName,
    //       changedStatus, createdBy, changedBy, fieldUsage,
    //       to_buDivs = []
    //     } = nestedpayload;

    //     if (!year || !Modeltype || !TargetTabName) {
    //       return req.error(400, 'year, Modeltype, and TargetTabName are required.');
    //     }

    //     // ensure header exists
    //     let header = await SELECT.one.from(CRVTargets).where({ year, Modeltype, TargetTabName });
    //     if (!header) {
    //       await INSERT.into(CRVTargets).entries({
    //         year, Modeltype, TargetTabName,
    //         changedStatus, fieldUsage, createdBy, changedBy
    //       });
    //     } else {
    //       await UPDATE(CRVTargets).set({
    //         changedStatus, fieldUsage, changedBy
    //       }).where({ year, Modeltype, TargetTabName });
    //     }

    //     // delete existing children for this header
    //     await DELETE.from(CRVDivisions).where({ year, Modeltype, TargetTabName });

    //     // insert new children
    //     if (to_buDivs.length > 0) {
    //       await INSERT.into(CRVDivisions).entries(
    //         to_buDivs.map(({ custBusUnit, custDivision }) => ({
    //           year, Modeltype, TargetTabName,
    //           custBusUnit: (custBusUnit || "").trim(),
    //           custDivision: (custDivision || "").trim()
    //         }))
    //       );
    //     }

    //     return 'Target Tab processed successfully';
    //   } catch (error) {
    //     return req.error(500, `Upsert/Create failed: ${error.message}`);
    //   }
    // });



    //  this.on('createupsertTargetTabs', async (req) => {
    //   const { nestedpayload } = req.data;
    //   try {
    //     const {
    //       year,
    //       Modeltype,
    //       TargetTabName,
    //       changedStatus,
    //       createdBy,
    //       changedBy,
    //       fieldUsage,
    //       to_buDivs = []   // ✅ instead of custBusUnits + to_divisions
    //     } = nestedpayload;

    //     if (!year || !Modeltype || !TargetTabName) {
    //       return req.error(400, 'year, Modeltype, and TargetTabName are required.');
    //     }

    //     // loop through each BU+Division pair
    //     for (const { custBusUnit, custDivision } of to_buDivs) {
    //       // check if record already exists
    //       const existing = await SELECT.from(CRVDivisions).where({
    //         year,
    //         Modeltype,
    //         TargetTabName,
    //         custBusUnit,
    //         custDivision
    //       });

    //       if (existing.length > 0) {
    //         // === UPDATE header only ===
    //         await UPDATE(CRVTargets).set({
    //           changedStatus,
    //           fieldUsage,
    //           changedBy
    //         }).where({ year, Modeltype, TargetTabName });
    //       } else {
    //         // === ensure header exists ===
    //         const header = await SELECT.one.from(CRVTargets).where({ year, Modeltype, TargetTabName });
    //         if (!header) {
    //           await INSERT.into(CRVTargets).entries({
    //             year,
    //             Modeltype,
    //             TargetTabName,
    //             changedStatus,
    //             fieldUsage,
    //             createdBy,
    //             changedBy
    //           });
    //         }

    //         // === create new BU+Division child ===
    //         await INSERT.into(CRVDivisions).entries({
    //           year,
    //           Modeltype,
    //           TargetTabName,
    //           custBusUnit,
    //           custDivision
    //         });
    //       }
    //     }

    //     return 'Target Tab processed successfully';
    //   } catch (error) {
    //     return req.error(500, `Upsert/Create failed: ${error.message}`);
    //   }
    // });



    this.on('readCRVExceptionMaster', async () => {
      return await SELECT.from(this.entities.CRVException);
    });

    this.on('readStatus', async () => {
      var sStatus = [];
      sStatus.push({
        StatusCode: 'S',
        StatusDescription: 'Submitted'
      },
        { StatusCode: 'W', StatusDescription: 'Sent for Approval' }, // RR Added this
        {
          StatusCode: 'O',
          StatusDescription: 'Obsolete'
        }, {
        StatusCode: 'P',
        StatusDescription: 'Published'
      }, {
        StatusCode: 'A',
        StatusDescription: 'Approved'
      }, {
        StatusCode: 'R',
        StatusDescription: 'Rejected'
      });

      return sStatus;
    });

    this.on('readTargetMaster', async () => {
      const Targets = await SELECT.from(CRVTargets);
      var targetdata = [];
      const seen = new Set();
      Targets.forEach(entry => {
        const key = `${entry.TargetTabName}`;
        if (!seen.has(key)) {
          seen.add(key);
          targetdata.push(entry.TargetTabName);
        }
      });
      return targetdata;
    });

    this.on('readApprovedby', async () => {
      const ApprovedData = await SELECT.from(crvModelsLaunch).columns('approvedby', 'approvedname');
      var Approvedby = [];
      const seen = new Set();
      ApprovedData.forEach(entry => {
        const key = `${entry.approvedby}`;
        if (!seen.has(key)) {
          seen.add(key);
          Approvedby.push({ approvedby: entry.approvedby, approvedname: entry.approvedname });
        }
      });
      return Approvedby;
    });

    this.on('readCreatedby', async () => {
      const CreatedData = await SELECT.from(crvModelsLaunch).columns('createdBy', 'createdname');
      var Createdby = [];
      const seen = new Set();
      CreatedData.forEach(entry => {
        const key = `${entry.createdBy}`;
        if (!seen.has(key)) {
          seen.add(key);
          Createdby.push({ createdBy: entry.createdBy, createdname: entry.createdname });
        }
      });
      return Createdby;
    });

    this.on('createnumberRange', async (req) => {
      req.user.id = req.req.authInfo.getEmail();
      const { year, Modeltype } = req.data;
      const pad = n => String(n || 0).padStart(4, '0');
      const createdBy = req.req.authInfo.getEmail();
      let row = await SELECT.one.from(NumberRange).where({ year, Modeltype }).orderBy('currentvalue desc');
      let Norows = await SELECT.one.from(NumberRange).where({ year, Modeltype, createdBy }).orderBy('currentvalue desc');
      if (!row) {
        // first time for this year/type → start at 1 (draft)
        await INSERT.into(NumberRange).entries({
          year, Modeltype, rangefrom: 1, rangeto: 9999, currentvalue: 1, status: 'D'
        });
        row = { year, Modeltype, currentvalue: 1, status: 'D' };

      } else {
        if (Norows) {
          // last one was finalized → move to next and mark as draft (reserve it)
          if (Norows.status === 'A') {
            const next = Math.min((row.currentvalue || 0) + 1, row.rangeto || 9999);
            await UPDATE(NumberRange)
              .set({ currentvalue: next, status: 'D' })
              .where({ year, Modeltype, createdBy });
            row.currentvalue = next;
            row.status = 'D';
          } else {
            row.currentvalue = Norows.currentvalue;
            row.status = 'D';
          }

        } else {
          const next = Math.min((row.currentvalue || 0) + 1, row.rangeto || 9999);
          await INSERT.into(NumberRange).entries({
            year, Modeltype, rangefrom: 1, rangeto: 9999, currentvalue: next, status: 'D'
          });
          row.currentvalue = next;
          row.status = 'D';
        }
      }
      // If status is already 'D', we just return the reserved one again.

      return { ModelId: `CM${year}${pad(row.currentvalue)}` };
    });

    this.on('postCRVModel', async (req) => {
      const b = req.data.payload || req.data;
      req.user.id = req.req.authInfo.getEmail();
      const model_Id = b.ModelId;
      const year = Number(b.year);
      const targetTab = b.Targettab;
      if (!model_Id || !year || !targetTab) return req.error(400, 'ModelId, year, Targettab are required');

      const toNum = v => Number(v ?? 0) || 0;

      const headerNums = {
        totalsalary: toNum(b.totalsalary),
        pool: parseFloat(b.pool).toFixed(2),
        pool_available: toNum(b.pool_available),
        totalDistributed: toNum(b.totalDistributed),
        totalDistrubuted_Percentage: toNum(b.totalDistrubuted_Percentage),
        remainingPool: toNum(b.remainingPool),
        remainingPool_Percentage: toNum(b.remainingPool_Percentage),
        remainingPoolbalance: toNum(b.remainingPoolbalance),
        publishedcomments: b.publishedcomments
      };
      const modelName = b.modelName;
      const createdname = b.createdname;

      // group rows by option
      const byOption = new Map();
      for (const h of (b.to_header || [])) {
        const opt = String(h.option || 'Option1').trim();
        if (!byOption.has(opt)) byOption.set(opt, []);
        byOption.get(opt).push(h);
      }

      const tx = cds.transaction(req);
      const MODEL_HDR = 'com.compmodel.ZHR_COMP_TBL_CRV_MODEL_HEADER';
      const THR_HDR = 'com.compmodel.ZHR_COMP_TBL_CRV_MODEL_THRSHLD_HEADER';
      const THR_ITEM = 'com.compmodel.ZHR_COMP_TBL_CRV_MODEL_THRSHLD_ITEM';

      for (const [option, rows] of byOption.entries()) {
        // build children payload once
        const hdrRows = rows.map((r, idx) => ({
          year, model_Id, targetTab, modelOption: option,
          custPerformancesubZone: String(r.performancesubzone || ''),
          payzones: String(r.payzone || ''),
          custPDScore: String(r.rating || ''),
          sequence: String(r.sequence || String(idx + 1)),
          count: Number(r.count || 0),
          totalBudget: toNum(r.budget),
          totalCost: toNum(r.total),
          indicator: String(r.Indicator || ''),
          status: 'S',
          to_ThresholdItems: (r.to_item || []).map((it, j) => ({
            year, model_Id, modelOption: option, targetTab,
            custPerformancesubZone: String(r.performancesubzone || ''),
            payzones: String(r.payzone || ''),
            custPDScore: String(r.rating || ''),
            threshold_Id: cds.utils.uuid(),
            compaRatioRanges: String(it.text || ''),
            startRange: String(it.startrange || ''),
            endRange: String(it.endrange || ''),
            percentage_val_from: toNum(it.threshholdfrom),
            percentage_val_to: toNum(it.threshholdto),
            percentage_text: `${it.threshholdfrom || 0}-${it.threshholdto || 0}%`,
            value: toNum(it.value),
            basecost: toNum(it.basecost),
            sequence: String(it.sequence || String(j + 1)),
            fieldUsage: 'A',
            status: 'S'
          }))
        }));

        const dup = await tx.run(
          SELECT.one.from(MODEL_HDR).columns('ID', 'status') //added status -09/18
            .where({ model_Id, targetTab, year, modelOption: option })
        );

        if (dup) {
          // begin 2025-09-18 change
          const updateData = { ...headerNums, modelName, createdname, status: 'S' };
          // if old status is not 'S' and we are saving as 'S' now, stamp changedAt/changedBy

          updateData.changedAt = new Date().toISOString();
          updateData.changedBy = req.user.id;

          // end 2025-09-18 change


          // update top-level header numbers/labels
          await tx.run(
            UPDATE(MODEL_HDR)
              .set(updateData)
              .where({ model_Id, targetTab, year, modelOption: option })
          );

          // await tx.run(
          //   UPDATE(MODEL_HDR)
          //     .set({ ...headerNums, modelName, createdname, status: 'S' })
          //     .where({ model_Id, targetTab, year, modelOption: option })
          // );

          // replace children (items first, then headers)
          await tx.run(DELETE.from(THR_ITEM).where({ model_Id, targetTab, year, modelOption: option }));
          await tx.run(DELETE.from(THR_HDR).where({ model_Id, targetTab, year, modelOption: option }));
          await tx.run(INSERT.into(THR_HDR).entries(hdrRows));
        } else {
          // deep insert header + children
          const entry = {
            model_Id, year, targetTab, modelOption: option,
            status: 'S', modelName,
            changedAt: new Date().toISOString(),
            changedBy: req.user.id,
            createdname, ...headerNums,
            to_ThresholdHeaders: hdrRows
          };
          await tx.run(INSERT.into(MODEL_HDR).entries(entry));
        }
      }

      return { ok: true, message: 'Saved', model_Id };
    });


    // after the inserts in postCRVModel finish successfully
    this.after('postCRVModel', async (result, req) => {
      if (!result?.ok) return;                   // only if save succeeded
      req.user.id = req.req.authInfo.getEmail();
      const b = req.data.payload || req.data;    // original input
      const year = Number(b.year);
      const modelId = result.model_Id || b.ModelId;
      const seq = parseInt(modelId.slice(-4), 10); // CM20250017 -> 17

      await cds.transaction(req).run(
        UPDATE(this.entities.NumberRange)
          .set({ status: 'A' })
          .where({ year, Modeltype: 'CRV', currentvalue: seq })
      );
    });


    this.on('readcreatemodel', async (req) => {
      const { year } = req.data;
      const compRatioMaster = await SELECT.from(CompensationRatioMaster).where({
        year: year,
        status: 'A'
      });
      if (compRatioMaster.length > 0) {
        const subzones = await SELECT.from(SubZones).where({
          year: year,
          fieldUsage: 'A'
        }).orderBy('sequence');
        if (subzones.length > 0) {

          const threshholdMaster = await SELECT.from(Thresholds).where({
            year: year,
            fieldUsage: 'A'
          }).orderBy('sequence');
          if (threshholdMaster.length <= 0) return null;
          const subzonesdata = subzones.map(c => ({
            performanceRating: compRatioMaster.find(s => s.performanceSubZone === c.performanceSubZone)?.performanceRating || '',
            performanceSubZone: c.performanceSubZone,
            payzones: compRatioMaster.find(s => s.performanceSubZone === c.performanceSubZone)?.payzones || '',
            sub_zonesequence: c.sequence
          })).sort((a, b) => Number(a.sub_zonesequence) - Number(b.sub_zonesequence));
          const aCompensationData = subzonesdata.map(c => ({
            performanceRating: c.performanceRating,
            performanceSubZone: c.performanceSubZone,
            payzones: c.payzones,
            sub_zonesequence: c.sub_zonesequence,
            to_columns: threshholdMaster.map(d => ({
              ID: d.ID,
              compaRatioRanges: d.compaRatioRanges,
              startRange: d.startRange,
              endRange: d.endRange,
              thresholdFrom: compRatioMaster.find(s => s.performanceSubZone === c.performanceSubZone
                && s.performanceRating === c.performanceRating
                && s.payzones === c.payzones
                && s.compaRatioRanges === d.compaRatioRanges
              )?.thresholdFrom || '',
              thresholdTo: compRatioMaster.find(s => s.performanceSubZone === c.performanceSubZone
                && s.performanceRating === c.performanceRating
                && s.payzones === c.payzones
                && s.compaRatioRanges === d.compaRatioRanges
              )?.thresholdTo || '',
              sequence: d.sequence
            })).sort((a, b) => Number(a.sequence) - Number(b.sequence))
          }));
          return aCompensationData;
        } else {
          return null;
        }

      } else {
        return null;
      }
    });

    this.on('readModelData', async (req) => {
      const { year, modelId, option } = req.data;
      var modelHeaders, modelItems;
      const model = await SELECT.from("com.compmodel.ZHR_COMP_TBL_CRV_MODEL_HEADER").where({
        year: year,
        model_Id: modelId,
        modelOption: option
      });



      if (model.length > 0) {
        const TargetData = await SELECT.from(CRVTargets).where({ TargetTabName: model[0].targetTab || '' });

        const DivisionsData = await SELECT.from(CRVDivisions).where({
          TargetTabName: model[0].targetTab,
          year: year
        });
        const Divisions = DivisionsData.map(d => d.custDivision);
        const BusinessUnits = [...new Set(DivisionsData.map(d => d.custBusUnit))];
        console.log(BusinessUnits);
        modelHeaders = await SELECT.from("com.compmodel.ZHR_COMP_TBL_CRV_MODEL_THRSHLD_HEADER").where({
          year: year,
          model_Id: modelId,
          modelOption: option
        });

        if (modelHeaders.length > 0) {
          modelItems = await SELECT.from("com.compmodel.ZHR_COMP_TBL_CRV_MODEL_THRSHLD_ITEM").where({
            year: year,
            model_Id: modelId,
            modelOption: option
          });
        }
        else {
          return null;
        }
        const groupedItems = {};
        for (const item of modelItems) {
          const key = `${item.custPerformancesubZone}|${item.payzones}|${item.custPDScore}`;
          if (!groupedItems[key]) groupedItems[key] = [];
          groupedItems[key].push({
            ID: item.threshold_Id,
            compaRatioRanges: item.compaRatioRanges,
            startRange: item.startRange,
            endRange: item.endRange,
            thresholdFrom: item.percentage_val_from,
            thresholdTo: item.percentage_val_to,
            sequence: item.sequence,
            value: item.value,
            basecost: item.basecost || 0.00
          });
        }
        // Prepare and sort headers and nested items
        const sortedModelHeaders = modelHeaders.map(header => {
          const key = `${header.custPerformancesubZone}|${header.payzones}|${header.custPDScore}`;
          const columns = groupedItems[key] || [];

          // Sort to_columns by sequence (as number if possible)
          columns.sort((a, b) => {
            return parseInt(a.sequence) - parseInt(b.sequence);
          });

          return {
            performanceSubZone: header.custPerformancesubZone,
            payzones: header.payzones,
            performanceRating: header.custPDScore,
            sub_zonesequence: header.sequence,
            count: header.count,
            totalBudget: header.totalBudget,
            totalCost: header.totalCost,
            indicator: header.indicator,
            to_columns: columns
          };
        });

        // Sort to_modelheader by sub_zonesequence (as number if possible)
        sortedModelHeaders.sort((a, b) => {
          return parseInt(a.sub_zonesequence) - parseInt(b.sub_zonesequence);
        });

        // Final response
        const response = {
          ID: model[0].ID,
          year: model[0].year,
          model_Id: model[0].model_Id,
          targetTab: model[0].targetTab,
          custBusUnit: TargetData[0].custBusUnit,
          modelOption: model[0].modelOption,
          totalsalary: model[0].totalsalary,
          pool: model[0].pool,
          pool_available: model[0].pool_available,
          totalDistributed: model[0].totalDistributed,
          totalDistrubuted_Percentage: model[0].totalDistrubuted_Percentage,
          remainingPool: model[0].remainingPool,
          remainingPool_Percentage: model[0].remainingPool_Percentage,
          remainingPoolbalance: model[0].remainingPoolbalance,
          status: model[0].status,
          modelName: model[0].modelName,
          publishedcomments: model[0].publishedcomments,
          to_modelheader: sortedModelHeaders,
          to_divisions: Divisions,
          to_businessUnits: BusinessUnits
        };
        return response;
      } else {
        return null;
      }
    });

    this.on('readModelId', async (req) => {
      const { year } = req.data;
      const model = await SELECT.from("com.compmodel.ZHR_COMP_TBL_CRV_MODEL_HEADER").where({
        year: year
      });
      if (model.length > 0) {
        var Models = [];
        const seen = new Set();
        model.forEach(entry => {
          const key = `${entry.model_Id}`;
          if (!seen.has(key)) {
            seen.add(key);
            Models.push({
              model_Id: entry.model_Id,
              modelName: entry.modelName
            });
          }
        });
        return Models;
      }
    });

    this.on('successfactorupload', async (req) => {
      const { payload } = req.data;
      const tx = cds.transaction(req);
      req.user.id = req.req.authInfo.getEmail();
      const SFTPDetails = await tx.run(
        SELECT.from(this.entities.IntegrationConfig)
          .where({ type: 'SFTP' })
      );

      const host = getFieldValue(SFTPDetails, 'HOST');
      const port = getFieldValue(SFTPDetails, 'PORT');
      const username = getFieldValue(SFTPDetails, 'USERNAME');
      const passwrd = getFieldValue(SFTPDetails, 'PASSWORD');


      if (!host || !port || !username || !passwrd) {
        return req.reject(400, 'SFTP Configuration missing please maintain details');
      }
      if (payload.length > 0) {
        const data = payload[0]; // later you can loop through payload if needed
        if (data) {
          try {
            const modelHeaders = await SELECT.from(crvModelsLaunch).where({
              year: data.year,
              status: { in: ['A', 'P'] }
            });

            if (!modelHeaders || modelHeaders.length === 0) {
              req.error(404, `No approved models found for year ${data.year}`);
              return;
            }

            const aFinal = [];
            var FormulaCount = 0;
            for (const header of modelHeaders) {
              const { model_Id, modelName, year, targetTab, modelOption, status } = header;

              const allBUDIVs = await SELECT
                .from(CRVDivisions)
                .where({ year, TargetTabName: targetTab });

              if (!allBUDIVs || allBUDIVs.length === 0) continue;

              const buGroups = {};
              allBUDIVs.forEach(row => {
                buGroups[row.custBusUnit] ??= [];
                buGroups[row.custBusUnit].push(row.custDivision);
              });

              /*const cnt1 = await SELECT.from(BusinessDivisions)
                .where({ year, custBusUnit: firstBUDIV.custBusUnit });

              const cnt2 = await SELECT.from(CRVDivisions)
                .where({ year, TargetTabName: targetTab });*/

              let aBUDIV = [];
              for (const [bu, divsForBU] of Object.entries(buGroups)) {
                // compare divisions count with BU master
                const cntMaster = await SELECT.from(BusinessDivisions).where({ year, custBusUnit: bu });
                if (cntMaster.length === divsForBU.length) {
                  // collapse into wildcard division
                  aBUDIV.push({ custBusUnit: bu, custDivision: "*" });
                } else {
                  divsForBU.forEach(div => {
                    aBUDIV.push({ custBusUnit: bu, custDivision: div });
                  });
                }
              }

              /* if (cnt1.length === cnt2.length) {
                 const modifiedRecord = { ...firstBUDIV, custDivision: "*" };
                 aBUDIV = [modifiedRecord];
               } else {
                 aBUDIV = await SELECT.from(CRVDivisions)
                   .where({ year, TargetTabName: targetTab });
               } */

              const aTHRSHLD = await SELECT.from(crvModelsHeaderItem)
                .where({ model_Id, year, targetTab, modelOption });

              for (const oBUDIV of aBUDIV) {
                const exceptionRow = await SELECT.one
                  .from(CRVException)
                  .where({
                    custBusUnit: oBUDIV.custBusUnit
                  });
                const companyCode = exceptionRow?.custCompanyCode;
                console.log(companyCode);
                for (const oTHRSHLD of aTHRSHLD) {
                  FormulaCount += 1;
                  var formulaPad = FormulaCount.toString();
                  aFinal.push({
                    // key1: oBUDIV.custBusUnit + oBUDIV.custDivision + oTHRSHLD.custPerformancesubZone + oTHRSHLD.compaRatioRanges,
                    // key2: oTHRSHLD.custPerformancesubZone + oTHRSHLD.compaRatioRanges,
                    //compaRatioRanges: oTHRSHLD.compaRatioRanges,
                    formulaName: 'Formula_' + formulaPad.padStart(4, '0'),
                    ratioFrom: (oTHRSHLD.startRange == '0.00' || oTHRSHLD.startRange == '0') ? '' : Math.floor(parseFloat(oTHRSHLD.startRange)).toString(),
                    ratioFromInclusive: (Math.floor(parseFloat(oTHRSHLD.startRange)) != '0') ? (parseFloat(oTHRSHLD.startRange) == Math.floor(parseFloat(oTHRSHLD.startRange))) ? 'TRUE' : 'FALSE' : '',
                    ratioTo: (oTHRSHLD.endRange == '999.00' || oTHRSHLD.endRange == '999.99' || oTHRSHLD.endRange == '999') ? '' : Math.ceil(parseFloat(oTHRSHLD.endRange)).toString(),
                    ratioToInclusive: (Math.ceil(parseFloat(oTHRSHLD.endRange)) != '1000') ? (parseFloat(oTHRSHLD.endRange) == Math.ceil(parseFloat(oTHRSHLD.endRange))) ? 'TRUE' : 'FALSE' : '',
                    customCriteria0: 'custCompanyAndBU',
                    customCriteria0_value: companyCode ? companyCode + '_' + oBUDIV.custBusUnit : oBUDIV.custBusUnit,
                    customCriteria0_fromValue: '',
                    customCriteria0_fromInclusive: '',
                    customCriteria0_toValue: '',
                    customCriteria0_toInclusive: '',
                    customCriteria1: 'custDivision',
                    customCriteria1_value: oBUDIV.custDivision,
                    customCriteria1_fromValue: '',
                    customCriteria1_fromInclusive: '',
                    customCriteria1_toValue: '',
                    customCriteria1_toInclusive: '',
                    customCriteria2: 'custPerformanceSubZone',
                    customCriteria2_value: oTHRSHLD.custPerformancesubZone,
                    customCriteria2_fromValue: '',
                    customCriteria2_fromInclusive: '',
                    customCriteria2_toValue: '',
                    customCriteria2_toInclusive: '',
                    min: oTHRSHLD.percentage_val_from,
                    low: oTHRSHLD.value,
                    default: oTHRSHLD.value,
                    high: oTHRSHLD.value,
                    max: oTHRSHLD.percentage_val_to
                  });
                }
              }
            }
            if (aFinal.length > 0) {
              try {
                // build Excel buffer
                const worksheet = XLSX.utils.json_to_sheet(aFinal);
                const workbookToExport = XLSX.utils.book_new();
                XLSX.utils.book_append_sheet(workbookToExport, worksheet, 'Sheet1');
                const excelBuffer = XLSX.write(workbookToExport, { type: 'buffer', bookType: 'xlsx' });

                // upload to SFTP
                const sftp = new Sftpclient();
                const timestamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 15);
                const publishPaths = await tx.run(
                  SELECT.from(this.entities.IntegrationConfig)
                    .where({ type: 'PUBLISH_PATH' })
                );
                const crvPath = getFieldValue(publishPaths, 'CRV_MODELING');

                if (!crvPath) {
                  return req.error(400, 'Publish path for CRV_MODELING is missing in IntegrationConfig');
                }
                const remoteFilePath = crvPath;
                //const remoteFilePath = 'FEED/UPLOAD/WFA/Compensation_Data_Modeling/CRVMatrixModeledGuidelinesUI';
                const fileName = `Final(Master_tab)UI_${timestamp}.xlsx`;
                const localFilePath = path.join(remoteFilePath, fileName);

                const config = {
                  host: host,
                  port: port,
                  username: username,
                  password: passwrd
                };

                await sftp.connect(config);
                const remoteDirectoryExists = await sftp.exists(remoteFilePath);
                if (!remoteDirectoryExists) {
                  await sftp.mkdir(remoteFilePath, true);
                }
                await sftp.put(excelBuffer, localFilePath);
                await sftp.end();

                // update statuses
                for (const h of modelHeaders) {
                  const updatedLaunch = await tx.run(
                    UPDATE(crvModelsLaunch).set({
                      status: 'P',
                      changedname: data.name,
                      publishedby: data.emailid,
                      publishedname: data.name,
                      publishedon: new Date().toISOString(),
                      //publishedcomments: data.comments
                    }).where({
                      year: h.year,
                      model_Id: h.model_Id,
                      targetTab: h.targetTab,
                      modelOption: h.modelOption
                    })
                  );

                  const updatedHeader = await tx.run(
                    UPDATE(crvModelsHeader).set({
                      status: 'P'
                    }).where({
                      year: h.year,
                      model_Id: h.model_Id,
                      targetTab: h.targetTab,
                      modelOption: h.modelOption
                    })
                  );


                  const updatedItem = await tx.run(
                    UPDATE(crvModelsHeaderItem).set({
                      status: 'P'
                    }).where({
                      year: h.year,
                      model_Id: h.model_Id,
                      targetTab: h.targetTab,
                      modelOption: h.modelOption
                    })
                  );
                }

                return { success: true, fileName, localFilePath };

              } catch (error) {
                console.error(error);
                req.error(500, `Failed to put file to SuccessFactors`);
                return;
              }
            }
          } catch (error) {
            console.error(error);
            req.error(500, `Unexpected error: ${error.message}`);
          }
        }
      }
    });


    this.on('roles', async (req) => {
      return {
        isAdmin: req.user.is('ZBTP_COMP_ROLE_ADMIN'),
        isUser: req.user.is('ZBTP_COMP_ROLE_USER'),
        isApprover: req.user.is('ZBTP_COMP_ROLE_APPROVER'),
        userEmail: req.req.authInfo.getEmail()
      }
    });

    //--dynamic service for smtp and sftp --- begin
    this.on('readIntegrationMeta', async (req) => {
      const { type } = req.data || {};

      // 1st dropdown: integration types
      if (!type) {
        return [
          { Code: 'SFTP', Desc: 'SFTP Connection' },
          { Code: 'SMTP', Desc: 'SMTP Mail' }
        ];
      }

      // 2nd dropdown: fields for SFTP
      if (type === 'SFTP') {
        return [
          { Code: 'host', Desc: 'SFTP Host' },
          { Code: 'port', Desc: 'SFTP Port' },
          { Code: 'username', Desc: 'SFTP Username' },
          { Code: 'password', Desc: 'SFTP Password' }
        ];
      }

      // 2nd dropdown: fields for SMTP
      if (type === 'SMTP') {
        return [
          { Code: 'TENANT_ID', Desc: 'Azure Tenant ID' },
          { Code: 'CLIENT_ID', Desc: 'Azure Client ID' },
          { Code: 'CLIENT_SECRET', Desc: 'Azure Client Secret' },
          { Code: 'SITE_ID', Desc: 'Launchpad Site ID' },
          { Code: 'TOKEN_URL', Desc: 'Azure OAuth Token URL' }
        ];
      }

      return [];
    });

    this.on('insertMultipleIntegrationConfig', async (req) => {
      const { entries } = req.data;
      req.user.id = req.req.authInfo.getEmail();
      if (!Array.isArray(entries) || entries.length === 0) {
        return req.error(400, 'No IntegrationConfig entries provided');
      }

      try {
        const tx = cds.tx(req);

        for (const e of entries) {
          // check if already exists
          const existing = await tx.run(
            SELECT.one.from(this.entities.IntegrationConfig)
              .where({ type: e.type, fieldName: e.fieldName })
          );

          if (existing) {
            // update value
            await tx.run(
              UPDATE(this.entities.IntegrationConfig)
                .set({ fieldValue: e.fieldValue })
                .where({ type: e.type, fieldName: e.fieldName })
            );
          } else {
            // insert new
            await tx.run(
              INSERT.into(this.entities.IntegrationConfig).entries(e)
            );
          }
        }

        return { message: `${entries.length} IntegrationConfig records processed` };
      } catch (error) {
        console.error('Insert/Update failed:', error);
        return req.error(500, `Insert/Update failed: ${error.message}`);
      }
    });

    //Delete Models
    this.on('deleteCRVModels', async (req) => {
      var aError = false;
      var aErrorMessage;
      const { payload } = req.data || {};
      if (!Array.isArray(payload) || payload.length === 0) {
        return { status: '404', message: 'No Data Found' };
      }
      const tx = cds.transaction(req);
      const MODEL_HDR = 'com.compmodel.ZHR_COMP_TBL_CRV_MODEL_HEADER';
      const THR_HDR = 'com.compmodel.ZHR_COMP_TBL_CRV_MODEL_THRSHLD_HEADER';
      const THR_ITEM = 'com.compmodel.ZHR_COMP_TBL_CRV_MODEL_THRSHLD_ITEM';
      for (let i = 0; i < payload.length; i++) {
        const model_Id = payload[i].ModelId;
        const targetTab = (payload[i].Targettab || "").trim();
        const year = parseInt(payload[i].year);
        const modelOption = (payload[i].option || "").trim();
        if (!model_Id || !targetTab || !modelOption) continue;
        try {
          const whereClause = {
            model_Id: payload[i].ModelId,
            targetTab: payload[i].Targettab.trim(),
            year: parseInt(payload[i].year),
            modelOption: payload[i].option
          };
          console.log(whereClause);
          await tx.run(DELETE.from(THR_ITEM).where({ model_Id, targetTab, year, modelOption }));
          await tx.run(DELETE.from(THR_HDR).where({ model_Id, targetTab, year, modelOption }));
          await tx.run(DELETE.from(MODEL_HDR).where({ model_Id, targetTab, year, modelOption }));
        } catch (error) {
          aError = true;
          aErrorMessage = error;
        }
      }
      if (aError == false) {
        return { status: '200', message: 'Models deleted successfully' }
      } else {
        req.error(500, `Unexpected error: ${aErrorMessage.message}`);
      }

    });

    //--dynamic service for smtp and sftp --- end

    return super.init();
  }
}
module.exports = { ZHR_COMP_CAP_CRVEXCEP_SRV };