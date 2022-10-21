const env = require('dotenv').config()
const request = require("request-promise");
const cheerio = require("cheerio");
const puppeteer = require("puppeteer");
var sqlite = require('sqlite3').verbose();
var csv = require('csv-express');//Optional, use it instead of res.json() to make a page for csv (downloadable)
const morgan = require('morgan');
const express = require('express');
const { engine } = require('express-handlebars');
const app = express();
//Note bug: After a while when a request happens, the program slows down but when the request ends, the program is repeating whatever it does in 6 seconds
//Date converter to mmddyy just to name databases
var yesterdate = new Date();
yesterdate.setDate(yesterdate.getDate() - 1);
var twodaysagodate= new Date();
twodaysagodate.setDate(yesterdate.getDate() - 1);
yesterdate = yesterdate.toLocaleString().split(',')[0];
twodaysagodate = twodaysagodate.toLocaleString().split(',')[0];
var todate = new Date(Date.now()).toLocaleString().split(',')[0];
for (let m=0;m<2 ;m++){
    yesterdate = yesterdate.replace("/" ,"");
    todate = todate.replace("/","");
    twodaysagodate = twodaysagodate.replace("/","");
};
alertMessage(5);

//Main code function, calls all other functions. Every database-creating function has two fail-safes. 
//1)It checks if the Db title already exists.(dbExistanceChecker) and if it does, it skips everything that has to do with that database (create,filling)
//2)It checks if today's db is identical by 30 rows with yesterday's. That will prevent duplicate tables with different dates if the owner of the site hasn't updated the table at the moment the algorithm checks.
(async () =>{
    let ident_block = 0;//ident_block changes value each time an identical table is found if it's any other number than 0, then it prevents the final database to be created.
   exists1 =  await dbExistanceChecker(`s${todate}s`);
    if (exists1 == false){
        await createFirstDb();//Creating and filling database which concerns the showtime of each show.
        identical = await identicalChecker(`s${todate}s`,`s${yesterdate}s`);
        if (identical == true){
            ident_block = ident_block+1;
        };
    };

    exists2 = await dbExistanceChecker(`r${yesterdate}r`);
    if (exists2 == false){
        await createSeconDb();//Creating and filling database which concerns the rating of each show.
        identical = await identicalChecker(`r${yesterdate}r`,`r${twodaysagodate}r`);
        if (identical == true){
            ident_block = ident_block+1;
       };
    };

    exists3 = await dbExistanceChecker(`f${yesterdate}f`);
    if (ident_block <= 0){
        if (exists3 == false && exists1 == false && exists2 == false){
            await dbCombiner();//Combines first and second database into a third one with showtimes and rating of each show at a given day.
            await dbOrganizer();//Deletes some extra columns as a side effect of INNER JOIN.
        };
    };
    if (exists3 == true){
        await serverStarter(`f${yesterdate}f`);//Starts up a server for displaying the grouped chart bar.
    }else if (exists3 == false){
        await serverStarter(`f${twodaysagodate}f`); 
    }
})(); 

//Server starter function (express)
async function serverStarter(db){

    exists = await dbExistanceChecker(db);
    if (!exists){return new Promise((resolve,reject)=>{
        alertMessage(10);
        resolve();
    })}
    var port = 3000;
    app.use(morgan('combined'));
    app.use(express.static('public'));
    app.engine('handlebars', engine());
    app.set('view engine', 'handlebars');
    app.set('views', './views');
    app.get('/', (req, res) => {
        res.render('home');
    });
    let json_obj = await jsonmaker(db);
    app.get('/api/data', (req, res) => {
        res.json(json_obj); //displays data as json 
    });
    app.get('/api/altdata', (req, res) => {
        res.csv(json_obj); //downloads data as csv
    });
    await new Promise((resolve,reject)=>{
        alertMessage(8,port)
        resolve(app.listen(port))
    });
};

//Creates 1st database (showtimes)
async function createFirstDb(){
    const browser = await puppeteer.launch({headless: true, args:['--no-sandbox']});//Uses pupeteer to get the data
    const page = await browser.newPage();
    await page.goto(env.parsed.SOURCE_SITE2);
    const html = await page.evaluate(()=>{
        return{
            rawhtml: document.documentElement.innerHTML
        }
    });
    const $ = cheerio.load(html.rawhtml);
    const pr_name = $(env.parsed.HTML_ELEM1);
    const pr_hour = $(env.parsed.HTML_ELEM2);
    const tb_length = $(env.parsed.HTML_ELEM3);
    const tb_name = $(env.parsed.HTML_ELEM4);
    var counter2 = 0;
    let db = new sqlite.Database('./dbrates.sqlite', sqlite.OPEN_READWRITE | sqlite.OPEN_CREATE);
    await new Promise((resolve,reject)=>{
        db.serialize(() => {
            db.run(`CREATE TABLE IF NOT EXISTS "s${todate}s" ("channel" TEXT NOT NULL,"show" TEXT NOT NULL,"startinghour" TEXT NOT NULL);`, (err) => {
                if (err) {
                    console.log(err);
                };
                alertMessage(1,`s${todate}s`)
                resolve();
            });
        });
    });
    for (let k=0;k<16;k++){
        if(typeof tb_name[k] === 'undefined'){//stops if there are no more data (foreach was not working for some reason).
            break;
        }
        for (let i = 0; i < tb_length[k].children[0].children.length - 1 ;i++){//scans everything that has to do with that html element. NOTE: "i" counter is not needed, could as well go with "while"
            var sched_array = [];
            if(typeof pr_name[i] === 'undefined')break;//stops if there are no more data (foreach was not working for some reason).
            
            //in every table there seems to be anomalies that involves it being inside one or two children elements. Those 6 lines below decide which one to use to get the element we need
            let tomakeiteasier = pr_name[counter2].children[0];
            if (typeof tomakeiteasier.children === 'undefined'){
                var showname = pr_name[counter2].children[0].data;
            }else{
                var showname = tomakeiteasier.children[0].data;
            };
            //Makes the shownames on uppercase and removes greek accents, just to eliminate asymetries
            showname = showname.toUpperCase();
            showname = showname.normalize("NFD").replace(/[\u0300-\u036f]/g, "")
            //Inserts all values on an array and then on database. NOTE: Can't remember why I did this, I could as well insert them without them being on an array
            let showtime = pr_hour[counter2].children[0].data;
            sched_array.push(tb_name[k].children[1].attribs.alt);
            sched_array.push(showname);
            sched_array.push(showtime);
            counter2 = counter2 + 1 ;
            await new Promise((resolve,reject)=>{
                db.serialize(function(rows){
                    var smmt = db.prepare(`INSERT OR REPLACE INTO "s${todate}s" VALUES(?,?,?)`);
                    smmt.run(sched_array[0],sched_array[1],sched_array[2]);
                    smmt.finalize();
                    resolve();
                });
            });
        };
    };
    alertMessage(2,`s${todate}s`);
    await new Promise((resolve,reject)=>{db.close(()=>{resolve();});});
    await browser.close();
};

//Creates the database of rating.
async function createSeconDb(){
    let k=0;
    let db = new sqlite.Database('./dbrates.sqlite', sqlite.OPEN_READWRITE | sqlite.OPEN_CREATE);
    await new Promise((resolve,reject)=>{
        db.serialize(() => {
            db.run(`CREATE TABLE IF NOT EXISTS "r${yesterdate}r" ("ch_name" TEXT NOT NULL DEFAULT 'NF',"sh_name" TEXT NOT NULL DEFAULT 'NF',"dyn_rating" TEXT NOT NULL DEFAULT 'NF',"sum_rating" TEXT NOT NULL DEFAULT 'NF');`, (err) => {
                if (err) {
                    console.log(err); 
                    reject();
                };
                alertMessage(1,`r${yesterdate}r`)
                resolve();
            });  
        });
    });
    const browser = await puppeteer.launch({headless: true, args:['--no-sandbox']});
    const page = await browser.newPage();
    await page.goto(env.parsed.SOURCE_SITE1);
    const html = await page.evaluate(()=>{
        return{
            rawhtml: document.documentElement.innerHTML
        };
    });
    const $ = cheerio.load(html.rawhtml);
    const tvrate = $(env.parsed.HTML_ELEM5);
    const showname = $(env.parsed.HTML_ELEM6);
    const ch_name = $(env.parsed.HTML_ELEM7);

    for (let i = 0 ;i < 100 ;i++){
        let packet = [];
        if (ch_name[i] == undefined){
            break;
        };
        channel_name = ch_name[i].attribs.alt;
        packet.push(channel_name);
        let show_name = showname[i].children[0].data;
        //Converts show's name to all capitals and no greek accent
        show_name = show_name.toUpperCase();
        show_name = show_name.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
        packet.push(show_name);
        let tv_rate1 = tvrate[k].children[0].data;
        packet.push(tv_rate1);
        let tv_rate2 = tvrate[k+1].children[0].data;
        packet.push(tv_rate2);
        k=k+2;

        await new Promise((resolve,reject)=>{
            db.serialize(function(rows){
                var smmt = db.prepare(`INSERT OR REPLACE INTO "r${yesterdate}r" VALUES(?,?,?,?)`);
                smmt.run(packet[0],packet[1],packet[2],packet[3]);
                smmt.finalize();
                resolve();
            }); 
        });
    };
    alertMessage(2,`r${yesterdate}r`)
    await browser.close();
    await new Promise((resolve,reject)=>{db.close(()=>{resolve();});});
};

//Creates the combined database using INNER JOIN
async function dbCombiner(){
    let dbrates = new sqlite.Database('./dbrates.sqlite', sqlite.OPEN_READWRITE | sqlite.OPEN_CREATE);
    await new Promise((resolve,reject)=>{
    dbrates.serialize(function(rows){
        var smmt = dbrates.prepare(`CREATE TABLE IF NOT EXISTS f${yesterdate}f AS SELECT * FROM s${yesterdate}s INNER JOIN r${yesterdate}r ON r${yesterdate}r.ch_name = s${yesterdate}s.channel AND r${yesterdate}r.sh_name = s${yesterdate}s.show ORDER BY startinghour`);
        smmt.run();
        smmt.finalize();
        resolve();
        });
        alertMessage(4,`f${yesterdate}f`);
    });
    await new Promise((resolve,reject)=>{dbrates.close(()=>{resolve();});});
}

//Deletes two extra columns that describe the channel and the showname of a show, it's duplicate due to INNER JOIN, the db is sorted by each show's hour
async function dbOrganizer(){
    let dbrates = new sqlite.Database('./dbrates.sqlite', sqlite.OPEN_READWRITE | sqlite.OPEN_CREATE);
    await new Promise((resolve,reject)=>{
        dbrates.serialize(function(rows){
            var smmt = dbrates.prepare(`ALTER TABLE f${yesterdate}f DROP COLUMN ch_name`);
            smmt.run();
            smmt.finalize();
        });
        dbrates.serialize(function(rows){
            var smmt = dbrates.prepare(`ALTER TABLE f${yesterdate}f DROP COLUMN sh_name`);
            smmt.run();
            smmt.finalize();
            resolve();
        });
    });
    await new Promise((resolve,reject)=>{dbrates.close(()=>{resolve();});});
};

//Pulls data from the combined Db, 
//1)groups all programs to show time groups (ex: if the program starts at 5:30 it gets to 5:00-6:00 hour range group)
//2)Compares previous with current rows, and removes duplicates from the array
//3)makes an array ready to be used by json
async function jsonmaker(dbname){
    return new Promise((resolve, reject) => {
        let db = new sqlite.Database('./dbrates.sqlite', sqlite.OPEN_READWRITE | sqlite.OPEN_CREATE);
        let jsontable = [];
        const sql = `SELECT channel ,show ,startinghour ,dyn_rating ,sum_rating FROM ${dbname}`;
        db.all(sql,[], function(error,rows){
            try{
                if (rows.length <= 0){
                    return;
                };
            } catch(error){
                console.error(error)
                reject();
            }
            if (error){
                throw error;
            };
            let oldchannelname;
            let oldshowname;
            let oldstartinghour;
            rows.forEach(function(row){
                let convertedrate = row.sum_rating.replace(",",".");
                convertedrate = convertedrate.replace("%","");
                let startinghour =  row.startinghour.replace(":","");
                startinghour = parseInt(startinghour);
                if       (startinghour >= 500 && startinghour <=600){
                    startinghour = "5:00 - 6:00";
                }else if (startinghour >= 601 && startinghour <=700){
                    startinghour = "6:00 - 7:00";
                }else if (startinghour >= 701 && startinghour <=800){
                    startinghour = "7:00 - 8:00";
                }else if (startinghour >= 801 && startinghour <=0900){
                    startinghour = "8:00 - 9:00";
                }else if (startinghour >= 901 && startinghour <=1000){
                    startinghour = "9:00 - 10:00";
                }else if (startinghour >= 1001 && startinghour <=1100){
                    startinghour = "10:00 - 11:00";
                }else if (startinghour >= 1101 && startinghour <=1200){
                    startinghour = "11:00 - 12:00";
                }else if (startinghour >= 1201 && startinghour <=1300){
                    startinghour = "12:00 - 13:00";
                }else if (startinghour >= 1301 && startinghour <=1400){
                    startinghour = "13:00 - 14:00";
                }else if (startinghour >= 1401 && startinghour <=1500){
                    startinghour = "14:00 - 15:00";
                }else if (startinghour >= 1501 && startinghour <=1600){
                    startinghour = "15:00 - 16:00";
                }else if (startinghour >= 1601 && startinghour <=1700){
                    startinghour = "16:00 - 17:00";
                }else if (startinghour >= 1701 && startinghour <=1800){
                    startinghour = "17:00 - 18:00";
                }else if (startinghour >= 1801 && startinghour <=1900){
                    startinghour = "18:00 - 19:00";
                }else if (startinghour >= 1901 && startinghour <=2000){
                    startinghour = "19:00 - 20:00";
                }else if (startinghour >= 2001 && startinghour <=2100){
                    startinghour = "20:00 - 21:00";
                }else if (startinghour >= 2101 && startinghour <=2200){
                    startinghour = "21:00 - 22:00";
                }else if (startinghour >= 2201 && startinghour <=2300){
                    startinghour = "22:00 - 23:00";
                }else if (startinghour >= 2301 && startinghour <=2359){
                    startinghour = "23:00 - 00:00";
                }else(startinghour = "23:00 - 00:00");  

                if (oldchannelname == row.channel  && oldshowname == row.show && oldstartinghour == startinghour){return;};
                jsontable.push({"channel": row.channel,"showname": row.show,"Startinghour":startinghour,"rate":  convertedrate});
                oldchannelname = row.channel;oldshowname = row.show;oldstartinghour = startinghour;
                
            });
            //console.log(jsontable)
        });
        db.close();
        resolve(jsontable);
    });
};

//function that checks if a table already exists, if it does, it skips everything it has to do with it.
async function dbExistanceChecker(dbname){
    return new Promise((resolve, reject) => {
        let exists = false;
        let db = new sqlite.Database('./dbrates.sqlite', sqlite.OPEN_READWRITE | sqlite.OPEN_CREATE);
        db.get(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`, `${dbname}`, (err, row) => {
            if (row!=undefined){
                exists = true;
                resolve(exists);
                alertMessage(6,dbname);
            }else{
                resolve(exists);
            };
        });
    });
};

//Checks if all the rows are the same as yesterday's table, if the statement is true, it deletes the new database and does not continue.
async function identicalChecker(todaydb,yesterdaydb){
    let db = new sqlite.Database('./dbrates.sqlite', sqlite.OPEN_READWRITE | sqlite.OPEN_CREATE);
    oldrows = await rowCounter(yesterdaydb,db)
    return new Promise((resolve, reject) => {
        var identical = false;
        const sql = `select * from ${yesterdaydb} INTERSECT select * from ${todaydb}`;
        db.serialize(() => {
            db.all(sql,[], function(error,rows){
                if (rows == undefined){
                    resolve(identical);
                }else if (rows.length == oldrows){
                    identical = true;
                    db.run(`DROP TABLE ${todaydb};`, (err) => {
                        if (err) {
                            console.log(err);
                        };
                        alertMessage(7,todaydb);
                        resolve(identical);
                    });
                }else{resolve(identical);}
            });
        });
    });
};

//Just counts the rows of a certain table
async function rowCounter(dbt,db){
    const sqlcount = `select * from ${dbt}`;
    return new Promise((resolve, reject) => {
        db.serialize(() => {
            db.all(sqlcount,[], function(error,rows){
                let oldrows = rows.length;
                resolve(oldrows)
            });
        });
    });
};

//function that gets feeded with a statuscode and a name (probably a database most of the times) and returns a certain colored console.log with a message
function alertMessage(statuscode,db){
    let enabled = false;
    if (enabled == false){return;}
    var detailedate = new Date(Date.now()).toLocaleString();
    switch (statuscode){
        case 1:  //database created
        console.log('\x1b[33m%s\x1b]0m',`${detailedate} - Database ${db} created.\n`);
        break;
        case 2: //database filled with data
        console.log('\x1b[32m%s\x1b]0m',`${detailedate} - Database ${db} gets filled with information.\n`);
        break;
        case 3: //gets modified
        console.log('\x1b[35m%s\x1b]0m',`${detailedate} - Database ${db} gets modified.\n`);
        break;
        case 4: //making a combined database
        console.log('\x1b[33m%s\x1b]0m',`${detailedate} - Making combined database ${db}.\n`);
        break;
        case 5: //Program starts / restarts
        console.log('\x1b[33m%s\x1b]0m',`${detailedate} - The script is running.\n`);
        break;
        case 6: //Database exists
        console.log('\x1b[33m%s\x1b]0m',`${detailedate} - Database ${db} already exists, skipping.\n`);
        break;
        case 7: //Found identical database
        console.log('\x1b[31m%s\x1b]0m',`${detailedate} - Database is identical,that may mean that the page I derive the data from have not refreshed them for the day, I will try again later. Deleting the database I created (${db}).\n`);
        break;
        case 8: //Server is up
        console.log('\x1b[35m%s\x1b]0m',`${detailedate} - Server is up on port ${db}\n`)
        break;
        case 9: //generic error
        console.log('\x1b[31m%s\x1b]0m',`${detailedate} - An uknown error occured.\n`)
        break;
        case 10: //error: Probably didn't get a db yesterday, missing database
        console.log('\x1b[31m%s\x1b]0m',`${detailedate} - Database is missing, probably because the script didn't get any information on the previous two days. WIll try again tommorow.\n`)
        break;
    };
    return;
};