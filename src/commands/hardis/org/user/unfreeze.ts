/* jscpd:ignore-start */
import { flags, SfdxCommand } from "@salesforce/command";
import { Messages /*, SfdxError*/ } from "@salesforce/core";
import { AnyJson } from "@salesforce/ts-types";
import * as c from "chalk";
import * as columnify from "columnify";
import { uxLog } from "../../../../common/utils";
import { executeApex } from "../../../../common/utils/deployUtils";
import { prompts } from "../../../../common/utils/prompts";

// Initialize Messages with the current plugin directory
Messages.importMessagesDirectory(__dirname);

// Load the specific messages for this file. Messages from @salesforce/command, @salesforce/core,
// or any library that is using the messages framework can also be loaded this way.
const messages = Messages.loadMessages("sfdx-hardis", "org");

export default class OrgUnfreezeUser extends SfdxCommand {
  public static title = "Unfreeze user in organization";

  public static description = messages.getMessage("orgUnfreezeUser");

  public static examples = [
    `$ sfdx hardis:org:user:unfreeze --targetusername dimitri.monge@gmail.com
    [sfdx-hardis]  Found 1 records:
    NAME              PROFILE  
    Dimitri Monge     Utilisateur standard
    ? 🦙   Are you sure you want to unfreeze this list of records in dimitri.monge@gmail.com (y/n)? ☑ Yes
    ....
    ....

    [sfdx-hardis]  updated 1 user, records:
    NAME              PROFILE
    Dimitri Monge     Utilisateur standard
  `,
    `$ sfdx hardis:org:user:unfreeze --targetusername dimitri.monge@gmail.com
    [sfdx-hardis]  Found 1 records:
    NAME                  PROFILE
    Dimitri Monge         Utilisateur standard
    √ 🦙   Are you sure you want to unfreeze this list of records in dimitri.monge@gmail.com (y/n)? » ☓ No
    [sfdx-hardis]  No user has been unfrozen
  `,
  ];

  // public static args = [{name: 'file'}];

  protected static flagsConfig = {
    // flag with a value (-n, --name=VALUE)
    name: flags.string({
      char: "n",
      description: messages.getMessage("nameFilter"),
    }),
    except: flags.string({
      char: "e",
      default: "system administrator,Administrateur système",
      description: messages.getMessage("exceptFilter"),
    }),
    debug: flags.boolean({
      char: "d",
      default: false,
      description: messages.getMessage("debugMode"),
    }),
  };

  // Comment this out if your command does not require an org username
  protected static requiresUsername = true;

  // Comment this out if your command does not support a hub org username
  // protected static supportsDevhubUsername = true;

  // Set this to true if your command requires a project workspace; 'requiresProject' is false by default
  protected static requiresProject = false;

  /* jscpd:ignore-end */

  public async run(): Promise<AnyJson> {
    const exceptFilter = this.flags.except ? this.flags.except.split(",") : ["System Administrator"];
    const nameFilter = this.flags.name || null;

    const debugMode = this.flags.debug || false;

    //select id, isfrozen, UserId from UserLogin where userid in (select id from user where profile.name NOT IN (\''+exceptFilter+'\') and isactive=true) AND isfrozen=false
    // Build query with name filter if sent
    let queryUser = `select id, isFrozen, UserId from UserLogin where userid in (select id from user where profile.name NOT IN ('${exceptFilter.join(
      "','"
    )}') and isactive=true`;
    if (nameFilter) {
      queryUser += " AND Name LIKE '%" + nameFilter + "%'";
    }
    queryUser += ") AND isfrozen=true";

    let apexcode =
      "list<userLogin> userLoginList = [" +
      queryUser +
      "]; \n" +
      "Set<Id> userIdList = new Set<Id>();\n" +
      "if(userLoginList != null && userLoginList.size()> 0){\n" +
      "for(UserLogin userfromList : userLoginList){\n" +
      "userIdList.add(userfromList.UserId);\n" +
      "}\n" +
      "}\n" +
      "list<User> userList = [SELECT Id,Name,Profile.Name FROM User WHERE Id IN :userIdList];\n" +
      "system.debug('OUTPUTVALUE='+JSON.serialize(userList)+'END_OUTPUTVALUE'); \n";

    const username = this.org.getUsername();

    const freezeQueryRes = await executeApex(apexcode, "apex-freeze.apex", username, debugMode);
    let logs = freezeQueryRes?.result?.logs || "";

    let userlistrawUnfreeze = JSON.parse(logs.split("OUTPUTVALUE=")[2].split("END_OUTPUTVALUE")[0]);
    // Check empty result
    if (userlistrawUnfreeze.length === 0) {
      const outputString = `No matching user records found for all profile  except ${exceptFilter}`;
      uxLog(this, c.yellow(outputString));
      return { deleted: [], outputString };
    }

    let userlist = userlistrawUnfreeze.map((record: any) => {
      return {
        Name: record.Name,
        Profile: record.Profile.Name,
      };
    });
    uxLog(this, `Found ${c.bold(userlist.length)} records:\n${c.yellow(columnify(userlist.splice(0, 500)))}`);

    userlistrawUnfreeze = [];
    const confirmUnfreeze = await prompts({
      type: "confirm",
      name: "value",
      initial: true,
      message: c.cyanBright(`Are you sure you want to freeze this list of records in ${c.green(this.org.getUsername())} (y/n)?`),
    });
    if (confirmUnfreeze.value === true) {
      {
        apexcode =
          "list<userLogin> userLoginList = [" +
          queryUser +
          "]; \n" +
          "Set<Id> userIdList = new Set<Id>();\n" +
          "if(userLoginList != null && userLoginList.size()> 0){\n" +
          "for(UserLogin userfromList : userLoginList){\n" +
          "userfromList.isFrozen = false;\n" +
          "userIdList.add(userfromList.UserId);\n" +
          "}\n" +
          "}\n" +
          "upsert userLoginList;\n" +
          "list<User> userList = [SELECT Id,Name,Profile.Name FROM User WHERE Id IN :userIdList];\n" +
          "system.debug('OUTPUTVALUE='+JSON.serialize(userList)+'END_OUTPUTVALUE'); \n";

        const freezeQueryRes = await executeApex(apexcode, "apex-freeze.apex", username, debugMode);
        logs = freezeQueryRes?.result?.logs || "";

        userlistrawUnfreeze = JSON.parse(logs.split("OUTPUTVALUE=")[2].split("END_OUTPUTVALUE")[0]);
      }

      if (userlistrawUnfreeze.length === 0) {
        const outputString = ` No user has been unfrozen`;
        uxLog(this, c.green(outputString));
        return { deleted: [], outputString };
      } else {
        userlist = userlistrawUnfreeze.map((record: any) => {
          return {
            Name: record.Name,
            Profile: record.Profile.Name,
          };
        });
        const summary = ` updated ${c.bold(userlist.length)} user, records:\n${c.yellow(columnify(userlist.splice(0, 500)))}`;

        uxLog(this, c.green(summary));
        // Return an object to be displayed with --json
        return { orgId: this.org.getOrgId(), outputString: summary };
      }
    }
  }
}
