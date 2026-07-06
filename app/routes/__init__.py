"""Blueprint registry. app.py calls register(app) once at import time."""

from api_utils import ApiError, api_error_response


def register(app):
    from routes.action_staff import bp as action_staff_bp
    from routes.compute_conflicts import bp as conflicts_bp
    from routes.data_availability import bp as availability_bp
    from routes.data_rules import bp as rules_bp
    from routes.data_shifts import bp as shifts_bp
    from routes.data_staff import bp as staff_bp

    app.register_blueprint(staff_bp)
    app.register_blueprint(availability_bp)
    app.register_blueprint(shifts_bp)
    app.register_blueprint(rules_bp)
    app.register_blueprint(conflicts_bp)
    app.register_blueprint(action_staff_bp)
    app.register_error_handler(ApiError, api_error_response)
