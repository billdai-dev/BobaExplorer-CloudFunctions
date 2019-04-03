//import * as firebase from 'firebase';
import * as functions from 'firebase-functions';
import * as geohash from 'ngeohash';
import * as admin from 'firebase-admin';
import { HTMLElement } from 'node-html-parser';

// Start writing Firebase Functions
// https://firebase.google.com/docs/functions/typescript

// export const helloWorld = functions.https.onRequest((request, response) => {
//     response.send("Hello from Firebase!");
// });
//firebase.initializeApp(functions.config().firebase);
admin.initializeApp();
const firestore = admin.firestore();

export const onTeaShopCreate = functions.firestore
    .document("/tea_shops/{shopId}")
    .onCreate((snapshot, context) => {
        const data = snapshot.data();
        if (data === undefined) {
            return null;
        }
        let lat = data.t;
        if (typeof lat === "string") {
            lat = parseFloat(lat);
        }
        let lng = data.g;
        if (typeof lng === "string") {
            lng = parseFloat(lng);
        }
        const hash = geohash.encode(lat, lng);

        let branchName: string = data.branchName;
        if (branchName !== undefined && branchName.charAt(branchName.length - 1) === "店") {
            branchName = branchName.substring(0, branchName.length - 1);
        }

        let city = data.city;
        let district = data.district;
        let address = data.address;

        if (city === undefined && district === undefined) {
            const result = parseAddress(address);
            city = result[0];
            district = result[1];
            address = result[2];
        }
        return snapshot.ref.set({
            t: admin.firestore.FieldValue.delete(), g: admin.firestore.FieldValue.delete(),
            branchName: branchName, city: city, district: district, address: address,
            position: { geopoint: new admin.firestore.GeoPoint(lat, lng), geohash: hash }
        }, { merge: true })
            .catch((error) => {
                console.log(error);
            });
    });

export const deleteShopData = functions.https.onRequest(async (req, res) => {
    const shop = req.query["shop"];

    if (shop === undefined || shop === null) {
        res.status(400).send(`Need query parameter: shop`);
        return;
    }
    const shopCollection = firestore.collection("/tea_shops");
    const query = shopCollection.where("shopName", "==", shop);
    const deletedAmount = await query.get().then(async (p) => {
        const count = p.size;
        for (const snapshot of p.docs) {
            await snapshot.ref.delete();
        }
        return count;
    });
    res.status(200).send(deletedAmount + ` ` + shop + `deleted!`);
});

export const parseTpteaData = functions.https.onRequest(async (req, res) => {
    const tpteaData = ``; //Copy contents in <tbody> manually and paste here

    const parser = require('node-html-parser');
    const p = parser.parse(tpteaData);
    const allData: HTMLElement[] = p.querySelectorAll("tr");
    console.log("Total:" + allData.length);
    for (let i = 0; i < allData.length; i++) {
        const element = allData[i];
        let branchName;
        let phone;
        let city;
        let district;
        let originalAddress: string = "";
        let address;
        let lat: string = "";
        let lng: string = "";
        const shopName = "茶湯會";

        const allTdData = element.querySelectorAll("td");
        let td = allTdData[0];
        if (td !== null) {
            branchName = td.querySelector("a").rawText.replace("店", "");
        }
        td = allTdData[1];
        if (td !== null) {
            phone = td.querySelector("a").rawText;
        }
        td = allTdData[2];
        if (td !== null) {
            const tagA = td.querySelector("a");
            const url = tagA.attributes["href"];
            const split = url.split("=");
            const position = split[split.length - 1].split(",");
            lat = position[0].replace(" ", "");
            lng = position[1].replace(" ","");
            originalAddress = td.rawText;
            const splitAddr = parseAddress(originalAddress);
            city = splitAddr[0];
            district = splitAddr[1];
            address = splitAddr[2];
        }
        if (!isNumberOnly(lat) || !isNumberOnly(lng)) {
            console.log("branch: " + branchName + " 無法獲得");
            continue;
        }
        if (i < 0) {
            console.log(shopName + "," + branchName + "," + phone + "," + city + "," + district + "," + address);
        }

        console.log("第" + i + "個: " + branchName + ` Lat:` + lat + `, Lng:` + lng);
        await firestore.collection("/tea_shops").add({
            shopName: shopName,
            branchName: branchName,
            city: city,
            district: district,
            address: address,
            phone: phone,
            t: lat,
            g: lng
        });
    }
    res.status(200).send("Success");
});

// export const parseMilkshopData = functions.https.onRequest(async (req, res) => {
//     //Total: 212
//     const fetchCount = 20;
//     const index = 200; //Change this

//     const parser = require('node-html-parser');
//     const rp = require('request-promise');
//     const milkShopUrl = "https://www.milkshoptea.com/store_detail.php?uID=22";

//     await rp((milkShopUrl)).then(async (html: string) => {
//         console.log("currentIndex:" + index);
//         const p = parser.parse(html);
//         const allData: HTMLElement[] = p.querySelectorAll(".store_box");
//         for (let i = index; i < allData.length; i++) {
//             if (i > index + fetchCount - 1) {
//                 break;
//             }
//             const element = allData[i];
//             let branchName;
//             let phone;
//             let city;
//             let district;
//             let originalAddress: string = "";
//             let address;
//             const shopName = "迷客夏";
//             const tagH3 = element.querySelector("h3");
//             if (tagH3 !== null) {
//                 tagH3.childNodes.forEach(e => {
//                     if (e instanceof TextNode) {
//                         branchName = e.rawText;
//                     }
//                 });
//             }
//             const tagP = element.querySelector("p");
//             if (tagP !== null) {
//                 tagP.childNodes.forEach(e => {
//                     if (e instanceof TextNode) {
//                         originalAddress = e.rawText.replace(" ", "");
//                         const addressInfo: string[] = parseAddress(originalAddress);
//                         city = addressInfo[0];
//                         district = addressInfo[1];
//                         address = addressInfo[2];
//                     }
//                 });
//             }
//             const tagLi = element.querySelectorAll("li");
//             if (tagLi !== null && tagLi.length === 2) {
//                 const li = tagLi[1];
//                 if (li instanceof Node) {
//                     phone = li.rawText;
//                 }
//             }

//             let lat: string = "";
//             let lng: string = "";

//             const pos = await parsePositionFromGmap(originalAddress);
//             if (pos !== null && pos.length === 2) {
//                 lat = pos[0];
//                 lng = pos[1];
//             }

//             if (!isNumberOnly(lat) || !isNumberOnly(lng)) {
//                 console.log("branch: " + branchName + " 無法獲得");
//                 continue;
//             }

//             console.log(branchName + ` Lat:` + lat + `, Lng:` + lng);
//             await firestore.collection("/tea_shops").add({
//                 shopName: shopName,
//                 branchName: branchName,
//                 city: city,
//                 district: district,
//                 address: address,
//                 phone: phone,
//                 t: lat,
//                 g: lng
//             });
//         }
//     });
//     res.status(200).send("Success");
// });


// export const parse50LanData = functions.https.onRequest(async (req, res) => {
//     //Total: 504
//     const fetchCount = 20;
//     const index = 500; //Iterate this

//     const parser = require('node-html-parser');
//     const rp = require('request-promise');
//     const _50LanShopUrl = "https://twcoupon.com/brandshop-50%E5%B5%90-%E9%9B%BB%E8%A9%B1-%E5%9C%B0%E5%9D%80.html";

//     await rp((_50LanShopUrl)).then(async (html: string) => {
//         console.log("currentIndex:" + index);
//         const p = parser.parse(html);
//         const allData: HTMLElement[] = p.querySelector(".right").querySelectorAll("li");
//         //console.log("Size:" + allData.length);

//         for (let i = index; i < allData.length; i++) {
//             if (i > index + fetchCount - 1) {
//                 break;
//             }
//             // if (i > 0) {
//             //     break;
//             // }

//             const element = allData[i];
//             let branchName;
//             let phone;
//             let city;
//             let district;
//             let originalAddress: string = "";
//             let address;
//             const shopName = "50嵐";

//             const allSpanData = element.querySelectorAll("span");
//             if (allSpanData.length !== 3) {
//                 continue;
//             }
//             const branch: HTMLElement = allSpanData[0].querySelector("a");
//             if (branch !== null) {
//                 branchName = branch.attributes["title"].split(" ")[1];
//                 // console.log("title: " + branchName);
//             }

//             const tel = allSpanData[1].querySelector("b");
//             if (tel !== null) {
//                 if (tel instanceof Node) {
//                     phone = tel.rawText;
//                     // console.log("telephone: " + phone);
//                 }
//             }

//             const addr = allSpanData[2].querySelector("b");
//             if (addr !== null) {
//                 if (addr instanceof Node) {
//                     originalAddress = addr.rawText;
//                     const splitAddr = parseAddress(addr.rawText);
//                     if (splitAddr.length === 3) {
//                         city = splitAddr[0];
//                         district = splitAddr[1];
//                         address = splitAddr[2];
//                     }
//                     // console.log("original:" + originalAddress + ", city:" + city + ", district:" + district + ", address:" + address);
//                 }
//             }

//             let lat: string = "";
//             let lng: string = "";

//             const pos = await parsePositionFromGmap(originalAddress);
//             if (pos !== null && pos.length === 2) {
//                 lat = pos[0];
//                 lng = pos[1];
//             }

//             if (!isNumberOnly(lat) || !isNumberOnly(lng)) {
//                 console.log("branch: " + branchName + " 無法獲得");
//                 continue;
//             }
//             console.log("LAT:" + lat + ", LNG:" + lng);
//             // if (i < 0) {
//             //     console.log(shopName + "," + branchName + "," + phone + "," + city + "," + district + "," + address);
//             // }
//             await firestore.collection("/tea_shops").add({
//                 shopName: shopName,
//                 branchName: branchName,
//                 city: city,
//                 district: district,
//                 address: address,
//                 phone: phone,
//                 t: lat,
//                 g: lng
//             });
//         }
//     });
//     res.status(200).send("Success");
// });

// export const parseDaYungsData = functions.https.onRequest(async (req, res) => {
//     //Total: 504
//     //const fetchCount = 20;
//     //const index = 500; //Iterate this


//     const daYungsData = ""; //See da_yungs_data.ts

//     const parser = require('node-html-parser');
//     const data = parser.parse(daYungsData);
//     const allData: HTMLElement[] = data.querySelectorAll("tr");
//     //console.log("Size:" + allData.length);

//     for (let i = 0; i < allData.length; i++) {
//         if (i < 0) {
//             break;
//         }

//         const element = allData[i];
//         let branchName;
//         let phone;
//         let city;
//         let district;
//         let originalAddress: string = ``;
//         let address;
//         let lat;
//         let lng;
//         const shopName = `大苑子`;

//         const allTdData = element.querySelectorAll("td");

//         let td = allTdData[0];
//         if (td instanceof Node) {
//             branchName = td.rawText.replace("店", "");
//         }
//         td = allTdData[1];
//         if (td instanceof Node) {
//             phone = td.rawText;
//         }
//         td = allTdData[3];
//         if (td instanceof Node) {
//             originalAddress = td.rawText;
//             const result = parseAddress(originalAddress);
//             city = result[0];
//             district = result[1];
//             address = result[2];
//         }
//         td = allTdData[4];
//         const aTag = td.querySelector("a");
//         const url = aTag.attributes["href"];
//         const split = url.split("/");
//         const position = split[split.length - 1].split(",");
//         lat = position[0];
//         lng = position[1];

//         // if(i<0){
//         //     console.log(shopName + "," + branchName + "," + phone + "," + city + "," + district + "," + address + "," + lat + "," + lng);
//         // }

//         await firestore.collection("/tea_shops").add({
//             shopName: shopName,
//             branchName: branchName,
//             city: city,
//             district: district,
//             address: address,
//             phone: phone,
//             t: lat,
//             g: lng
//         });
//     }

//     res.status(200).send("Success");
// });



//Return [city, district, address]
function parseAddress(address: any): string[] {
    let cityIndex: number;
    let districtIndex: number;

    if (address.includes(`市`) && address.includes(`區`)) {
        cityIndex = address.indexOf(`市`);
        districtIndex = address.indexOf(`區`, cityIndex);
    }
    else {
        cityIndex = address.indexOf(`縣`);
        const districtIndexArr: number[] = [address.indexOf(`鄉`), address.indexOf(`鎮`), address.indexOf(`市`)];
        districtIndexArr.sort();
        const last = districtIndexArr.pop();
        districtIndex = last === undefined ? -1 : last;
    }
    let city: string = address.substring(0, cityIndex + 1);
    if (containsNumber(city)) {
        let startIndex = 0;
        while (containsNumber(address.charAt(startIndex))) {
            startIndex++;
        }
        city = address.substring(startIndex, city.length);
    }
    const district: string = address.substring(cityIndex + 1, districtIndex + 1);
    const newAddress: string = address.substring(districtIndex + 1);
    return [city, district, newAddress];
}

// async function parsePositionFromGmap(address: string): Promise<string[]> {
//     const mapUrlPrefix = "https://www.google.com.tw/maps/place/";
//     const rp = require('request-promise');

//     return rp(mapUrlPrefix + encodeURIComponent(address)).then((data: string) => {
//         const position = parseGeoPosition(data, address);
//         // console.log("Position:" + position);
//         return position === null || position.length !== 2 ? [] : position;

//     }).catch((err: any) => { console.log(err); });

//     //Return [latitude, longitude]
//     function parseGeoPosition(data: string, originalAddress: string): string[] | null {
//         const startIndex = data.indexOf(originalAddress);
//         if (startIndex < 0) {
//             return null;
//         }
//         const leftBracketPos = data.indexOf("[", startIndex);
//         const rightBracketPos = data.indexOf("]", leftBracketPos);
//         const str = data.substring(leftBracketPos + 1, rightBracketPos);
//         const split = str.split(",");
//         const parsedPosition: string[] = [];
//         for (const element of split) {
//             if (isNumberOnly(element)) {
//                 parsedPosition.push(element);
//             }
//             if (parsedPosition.length === 2) {
//                 break;
//             }
//         }
//         return parsedPosition;
//     }
// }

function containsNumber(str: string) {
    return /\d/.test(str);
}

function isNumberOnly(str: string) {
    return /^\d+(\.\d+)?$/.test(str);
}