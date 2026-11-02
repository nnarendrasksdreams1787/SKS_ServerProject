const pool = require("../DB/db")

function destoryAdminSession(req, res, statusCode, message){
    return req.session.destroy((error)=>{
        if (error) {
            console.error("Unable to destroy admin session: ", error.message);

            return res.status(500).json({
                message: "Unable to clear admin session",
            })
        }

        res.clearCookie("sks_admin.sid", {
            httpOnly: true,
            secure: process.env.NODE_ENV === "production",
            sameSite: "lax",
            path: "/",
        })

        return res.status(statusCode).json({message});
    })
}



async function requireAdmin(req, res, next) {
    try {
        const adminId = req.session?.adminId;

        if (!adminId){
            return res.status(401).json({
                message: "Admin authentication required",
            })
        }

        const [admins] = await pool.execute(
            `SELECT admin_id, email, status 
            FROM platform_admins 
            WHERE admin_id = ?
            LIMIT 1`,
            [adminId]
        );

        const admin = admins[0];
        if (!admin || admin.status !== "active"){
            // return res.session.distory(()=> {
            //     res.clearCookis("sks_addmin.sid");
                
            //     return res.status(401).json({
            //         message: "Admin sessino is invalid or disabled",
            //     });
            // });

            return destoryAdminSession(
                req,
                res,
                401,
                "Admin session is invalid or disabled"
            )
        }

        req.admin = {
            id: admin.admin_id,
            email: admin.email,
        }

        return next();

    } catch (error) {
        console.error("Admin authentication error: ", error.message);
        res.status(500).json({
            message: "Unable to verify admin session",
        })
    }
}


module.exports = requireAdmin;