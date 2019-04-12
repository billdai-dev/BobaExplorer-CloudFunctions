//import * as firebase from 'firebase';
import * as functions from 'firebase-functions';
import * as geohash from 'ngeohash';
import * as admin from 'firebase-admin';
import { HTMLElement } from 'node-html-parser';
import { DocumentData } from '@google-cloud/firestore';
import * as geocode from '@google/maps';

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

export const deleteWrongShop = functions.https.onRequest(async (req, res) => {
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
            const pos = snapshot.data().position;
            if (pos === null || pos === undefined) {
                console.log(`Delete ${snapshot.data().branchName}`)
                await snapshot.ref.delete();
            }
        }
        return count;
    });
    res.status(200).send(deletedAmount + ` ` + shop + `deleted!`);
});

export const updateShopField = functions.https.onRequest(async (req, res) => {
    const shop = req.query["shop"];
    const key = req.query["key"];
    let value = req.query["value"];
    if (isNumberOnly(value)) {
        value = Number(value);
    }

    if (shop === undefined || shop === null || key === undefined || key === null) {
        res.status(400).send(`Need both query parameter: shop, key`);
        return;
    }
    const shopCollection = firestore.collection("/tea_shops");
    const query = shopCollection.where("shopName", "==", shop);
    const updatedAmount = await query.get().then(async (p) => {
        let count = 0;
        for (const snapshot of p.docs) {
            const data = snapshot.data();
            if (data.pinColor !== null && data.pinColor !== undefined) {
                continue;
            }
            count++;
            await snapshot.ref.set({ [key]: value }, { merge: true });
        }
        return count;
    });
    res.status(200).send(updatedAmount + ` ` + shop + `updated!`);
});

export const updateShopPos = functions.https.onRequest(async (req, res) => {
    const shop = req.query["shop"];
    const branch = req.query["branch"];
    let lat: any = req.query["lat"];
    if (typeof lat === "string") {
        lat = parseFloat(lat);
    }
    let lng: any = req.query["lng"];
    if (typeof lng === "string") {
        lng = parseFloat(lng);
    }

    if (shop === undefined || shop === null || branch === undefined || lat === null || lng === null) {
        res.status(400).send(`Parameters not enough`);
        return;
    }
    const shopCollection = firestore.collection("/tea_shops");
    const query = shopCollection.where("shopName", "==", shop).where("branchName", "==", branch);
    const updatedAmount = await query.get().then(async (p) => {
        const count = p.size;
        if (count > 1) {
            console.log(`More than 1 ${branch}`);
            return 0;
        }
        for (const snapshot of p.docs) {
            const hash = geohash.encode(lat, lng);
            await snapshot.ref.set({ position: { geopoint: new admin.firestore.GeoPoint(lat, lng), geohash: hash } }, { merge: true });
        }
        return count;
    });
    res.status(200).send(updatedAmount + ` ` + shop + `updated!`);
});

export const deleteShopField = functions.https.onRequest(async (req, res) => {
    const shop = req.query["shop"];
    const field = req.query["field"];

    if (shop === undefined || shop === null || field === undefined || field === null) {
        res.status(400).send(`Need both query parameter: shop, field`);
        return;
    }
    let updateData: DocumentData;
    if (field === `position`) {
        updateData = { [field]: admin.firestore.FieldValue.delete(), geohash: admin.firestore.FieldValue.delete() };
    }
    else {
        updateData = { [field]: admin.firestore.FieldValue.delete() };
    }
    const shopCollection = firestore.collection("/tea_shops");
    const query = shopCollection.where("shopName", "==", shop);
    const updatedAmount = await query.get().then(async (p) => {
        const count = p.size;
        for (const snapshot of p.docs) {
            await snapshot.ref.set(updateData, { merge: true });
        }
        return count;
    });
    res.status(200).send(updatedAmount + ` ` + shop + `updated!`);
});

export const parseShopGeocode = functions.https.onRequest(async (req, res) => {
    const shop = req.query["shop"];

    if (shop === undefined || shop === null) {
        res.status(400).send(`Need query parameter: shop`);
        return;
    }
    const shopCollection = firestore.collection("/tea_shops");
    const query = shopCollection.where("shopName", "==", shop);
    const updatedAmount = await query.get().then(async (p) => {
        //const count = p.size;
        let i = 0;
        for (const snapshot of p.docs) {
            if (i > 49) {
                break;
            }
            const data = snapshot.data();
            if (data.position !== null && data.position !== undefined) {
                continue;
            }
            i++;
            const latLng = await geocodeAddress(`${data.city}${data.district}${data.address}`);
            if (latLng === null || latLng === undefined || latLng.length !== 2) {
                console.log(`${data.branchName} parse geocode failed`)
                continue;
            }
            let lat: any = latLng[0];
            if (typeof lat === "string") {
                lat = parseFloat(lat);
            }
            let lng: any = latLng[1];
            if (typeof lng === "string") {
                lng = parseFloat(lng);
            }
            const hash = geohash.encode(lat, lng);
            await snapshot.ref.set({ position: { geopoint: new admin.firestore.GeoPoint(lat, lng), geohash: hash } }, { merge: true });
        }
        return i;
    });
    res.status(200).send(updatedAmount + ` ` + shop + `updated!`);
});

export const parseMrWishData = functions.https.onRequest(async (req, res) => {
    const fetchCount = 20;
    const index = req.query["index"];
    const parser = require('node-html-parser');
    const rp = require('request-promise');
    const mrWishShopUrl = `http://www.mr-wish.com/shop_region.php?uID=1`;
    await rp((mrWishShopUrl)).then(async (html: string) => {
        const p = parser.parse(html);
        const allData: HTMLElement[] = p.querySelector("#about05").querySelector(".shop_all").querySelectorAll(".COURSE");
        console.log("Total:" + allData.length);
        for (let i = index; i < allData.length; i++) {
            if (i > index + fetchCount - 1) {
                break;
            }
            const element = allData[i];
            let branchName;
            let phone;
            let city;
            let district;
            let originalAddress: string = "";
            let address;
            let lat: string = "";
            let lng: string = "";
            const shopName = "Mr.Wish";

            const h3Tag = element.querySelector("h3");
            if (h3Tag !== null) {
                branchName = h3Tag.rawText.replace("店", "").trim();
            }
            const divTag = element.querySelector("div");
            const liTags = divTag.querySelector("ul").querySelectorAll("li");
            let liTag = liTags[0];
            if (liTag !== null) {
                phone = liTag.rawText.trim();
            }
            liTag = liTags[1];
            if (liTag !== null) {
                originalAddress = liTag.rawText.trim();
                const splitAddr = parseAddress(originalAddress);
                city = splitAddr[0];
                district = splitAddr[1];
                address = splitAddr[2];
            }
            const pos = await geocodeAddress(`${city}${district}${address}`);
            if (pos !== null && pos.length === 2) {
                lat = pos[0];
                lng = pos[1];
            }

            if (!isNumberOnly(lat) || !isNumberOnly(lng)) {
                console.log("branch: " + branchName + " 無法獲得");
                continue;
            }
            // if (i < 0) {
            console.log(shopName + "," + branchName + "," + phone + "," + city + "," + district + "," + address);
            // }

            console.log("第" + (i + 1) + "個: " + branchName + ` Lat:` + lat + `, Lng:` + lng);
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
    });
    res.status(200).send("Success");
});

// export const parseKebukeData = functions.https.onRequest(async (req, res) => {
//     const parser = require('node-html-parser');
//     const html = ``;
//     const p = parser.parse(html);
//     const allData: HTMLElement[] = p.querySelectorAll("tr");
//     console.log("Total:" + allData.length);
//     for (let i = 0; i < allData.length; i++) {
//         const element = allData[i];
//         let branchName;
//         let phone;
//         let city;
//         let district;
//         let originalAddress: string = "";
//         let address;
//         let lat: string = "";
//         let lng: string = "";
//         const shopName = "可不可熟成紅茶";

//         const tdTags = element.querySelectorAll("td");
//         let tdTag = tdTags[0];
//         if (tdTag !== null) {
//             //const spanTag = tdTag.querySelector("span");
//             branchName = tdTag.rawText.replace("店", "");
//         }
//         tdTag = tdTags[1];
//         if (tdTag !== null) {
//             const spanTag = tdTag.querySelector("span");
//             phone = spanTag.rawText;

//             originalAddress = tdTag.rawText.replace(phone, "");
//             const splitAddr = parseAddress(originalAddress);
//             city = splitAddr[0];
//             district = splitAddr[1];
//             address = splitAddr[2];


//         }
//         tdTag = tdTags[3];
//         if (tdTag !== null) {
//             const url = tdTag.querySelector("a").attributes["href"];
//             const capturedLatLng = url.substring(url.lastIndexOf("!3d") + 3,
//                 url.includes("zh-TW") ? url.lastIndexOf("?") : url.length);
//             const latLng = capturedLatLng.split("!4d");
//             lat = latLng[0];
//             lng = latLng[1];
//         }

//         if (!isNumberOnly(lat) || !isNumberOnly(lng)) {
//             console.log("branch: " + branchName + " 無法獲得");
//             continue;
//         }
//         // if (i < 0) {
//         console.log(shopName + "," + branchName + "," + phone + "," + city + "," + district + "," + address);
//         // }

//         console.log("第" + (i + 1) + "個: " + branchName + ` Lat:` + lat + `, Lng:` + lng);
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

// export const parseChingShinData = functions.https.onRequest(async (req, res) => {
//     //Total: 504
//     //     const fetchCount = 20;
//     //     const index = 500; //Iterate this
//     const cityIndex = req.query["city"];
//     const page = req.query["page"];

//     const parser = require('node-html-parser');
//     const rp = require('request-promise');
//     const chingShinShopUrl = `http://www.chingshin.tw/store.php?city=${cityIndex}&page=${page}`; //Change city and page index
//     await rp((chingShinShopUrl)).then(async (html: string) => {
//         const p = parser.parse(html);
//         const allData: HTMLElement[] = p.querySelector("#tab-4").querySelector(".row").querySelectorAll("div");
//         allData.pop();
//         console.log("Total:" + allData.length);
//         for (let i = 0; i < allData.length; i++) {
//             const element = allData[i];
//             let branchName;
//             let phone;
//             let city;
//             let district;
//             let originalAddress: string = "";
//             let address;
//             let lat: string = "";
//             let lng: string = "";
//             const shopName = "清心福全";

//             const h3Tag = element.querySelector("h3");
//             if (h3Tag !== null) {
//                 const title = h3Tag.rawText;
//                 branchName = title.substring(title.indexOf("「") + 1, title.indexOf("」")).replace("店", "");
//             }
//             const allPData = element.querySelectorAll("p");
//             let pData = allPData[0];
//             if (pData !== null) {
//                 originalAddress = pData.rawText.trim();
//                 const splitAddr = parseAddress(originalAddress);
//                 city = splitAddr[0];
//                 district = splitAddr[1];
//                 address = splitAddr[2];
//             }
//             pData = allPData[1];
//             if (pData !== null) {
//                 let text = pData.rawText
//                 if (text.includes("（")) {
//                     text = text.substring(0, text.indexOf("（")).trim();
//                 }
//                 phone = text;
//             }

//             //const pos = await parsePositionFromGmap(originalAddress);
//             const pos = await geocodeAddress(`${city}${district}${address}`);
//             if (pos !== null && pos.length === 2) {
//                 lat = pos[0];
//                 lng = pos[1];
//             }

//             if (!isNumberOnly(lat) || !isNumberOnly(lng)) {
//                 console.log("branch: " + branchName + " 無法獲得");
//                 continue;
//             }
//             // if (i < 0) {
//             console.log(shopName + "," + branchName + "," + phone + "," + city + "," + district + "," + address);
//             // }

//             console.log("第" + (i + 1) + "個: " + branchName + ` Lat:` + lat + `, Lng:` + lng);
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

// export const parseTpteaData = functions.https.onRequest(async (req, res) => {
//     const tpteaData = ``; //Copy contents in <tbody> manually and paste here

//     const parser = require('node-html-parser');
//     const p = parser.parse(tpteaData);
//     const allData: HTMLElement[] = p.querySelectorAll("tr");
//     console.log("Total:" + allData.length);
//     for (let i = 0; i < allData.length; i++) {
//         const element = allData[i];
//         let branchName;
//         let phone;
//         let city;
//         let district;
//         let originalAddress: string = "";
//         let address;
//         let lat: string = "";
//         let lng: string = "";
//         const shopName = "茶湯會";

//         const allTdData = element.querySelectorAll("td");
//         let td = allTdData[0];
//         if (td !== null) {
//             branchName = td.querySelector("a").rawText.replace("店", "");
//         }
//         td = allTdData[1];
//         if (td !== null) {
//             phone = td.querySelector("a").rawText;
//         }
//         td = allTdData[2];
//         if (td !== null) {
//             const tagA = td.querySelector("a");
//             const url = tagA.attributes["href"];
//             const split = url.split("=");
//             const position = split[split.length - 1].split(",");
//             lat = position[0].replace(" ", "");
//             lng = position[1].replace(" ","");
//             originalAddress = td.rawText;
//             const splitAddr = parseAddress(originalAddress);
//             city = splitAddr[0];
//             district = splitAddr[1];
//             address = splitAddr[2];
//         }
//         if (!isNumberOnly(lat) || !isNumberOnly(lng)) {
//             console.log("branch: " + branchName + " 無法獲得");
//             continue;
//         }
//         if (i < 0) {
//             console.log(shopName + "," + branchName + "," + phone + "," + city + "," + district + "," + address);
//         }

//         console.log("第" + i + "個: " + branchName + ` Lat:` + lat + `, Lng:` + lng);
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

async function geocodeAddress(address: string) {
    const googleMapsClient = geocode.createClient({
        key: 'AIzaSyAejNrfQBqK45EVlhOdpDrUirNu-O3WxXg',
        Promise: Promise
    });
    return googleMapsClient.geocode({
        address: address, region: `tw`, language: `zh-TW`
    }).asPromise()
        .then((response) => {
            const geometry = response.json.results[0].geometry
            const location = geometry.location;
            const formattedAddress = response.json.results[0].formatted_address;
            const isTheSame = formattedAddress.includes(address);
            console.log(`Original address: ${address}`)
            console.log(`FormattedAddress: ${formattedAddress}`);
            console.log(`Both the same: ${isTheSame}`);
            return location !== null ? [location.lat.toString(), location.lng.toString()] : [];
        })
        .catch((err) => {
            console.log(err);
            return [];
        });
}

function containsNumber(str: string) {
    return /\d/.test(str);
}

function isNumberOnly(str: string) {
    return /^\d+(\.\d+)?$/.test(str);
}